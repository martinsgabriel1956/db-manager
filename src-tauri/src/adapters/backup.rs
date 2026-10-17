//! Backup and restore through the database's own client tools (`pg_dump`, `pg_restore`,
//! `psql`, `mysqldump`, `mysql`), found in PATH like the tunnel's `ssh`. The password
//! reaches them only through the child's environment (`PGPASSWORD`, `MYSQL_PWD`), never
//! the arguments, which any user can read in `ps`.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{ExitStatus, Stdio};
use std::time::Duration;

use tokio::io::AsyncReadExt;
use tokio::process::Command;

use crate::adapters::ssh::die_with_parent;
use crate::domain::{AppError, BackupFormat, TlsConfig, TlsMode};

/// How often a running tool checks whether it was cancelled.
const POLL: Duration = Duration::from_millis(100);
/// The end of stderr, where the tools say what failed, goes into the error.
const STDERR_TAIL: usize = 4000;

/// Where a tool connects: the database's address, or the SSH tunnel's local port.
pub struct Endpoint<'a> {
    pub host: &'a str,
    pub port: u16,
    pub database: &'a str,
    pub username: &'a str,
    pub password: Option<&'a str>,
    pub tls: &'a TlsConfig,
}

/// One run of a client tool, as it will be shown and as it will run.
#[derive(Debug)]
pub struct Job {
    program: &'static str,
    args: Vec<String>,
    /// TLS settings: part of the shown command
    envs: Vec<(&'static str, String)>,
    /// the password: in the child's environment only, never shown
    secret: Option<(&'static str, String)>,
    /// fed to stdin: `mysql` reads the dump there
    stdin: Option<PathBuf>,
}

pub fn pg_dump(endpoint: &Endpoint, format: BackupFormat, file: &Path) -> Result<Job, AppError> {
    let format_args: &[&str] = match format {
        BackupFormat::Custom => &["--format=custom"],
        // what pg_restore --clean does for the custom format, written into the SQL itself
        BackupFormat::Sql => &["--format=plain", "--clean", "--if-exists", "--no-owner"],
        BackupFormat::SqliteFile => {
            return Err(AppError::validation(
                "formato de backup não existe no Postgres",
            ));
        }
    };
    let mut job = postgres("pg_dump", endpoint);
    job.args
        .extend(format_args.iter().map(|arg| arg.to_string()));
    job.args.push(format!("--file={}", file.display()));
    Ok(job)
}

/// A custom-format archive: existing objects of the archive are dropped and recreated,
/// all in one transaction that stops at the first error.
pub fn pg_restore(endpoint: &Endpoint, file: &Path) -> Job {
    let mut job = postgres("pg_restore", endpoint);
    job.args.extend(
        [
            "--clean",
            "--if-exists",
            "--no-owner",
            "--single-transaction",
            "--exit-on-error",
        ]
        .map(String::from),
    );
    job.args.push(file.display().to_string());
    job
}

/// A plain SQL dump, run as it is in one transaction that stops at the first error.
pub fn psql(endpoint: &Endpoint, file: &Path) -> Job {
    let mut job = postgres("psql", endpoint);
    job.args.extend(
        [
            "--no-psqlrc",
            "--quiet",
            "--single-transaction",
            "--set=ON_ERROR_STOP=1",
        ]
        .map(String::from),
    );
    job.args.push(format!("--file={}", file.display()));
    job
}

/// Consistent InnoDB snapshot, with routines and triggers. `--no-tablespaces` spares the
/// PROCESS privilege that MySQL 8.0.21+ asks for otherwise.
pub fn mysqldump(endpoint: &Endpoint, file: &Path) -> Job {
    let mut job = mysql_client("mysqldump", endpoint);
    job.args.extend(
        [
            "--single-transaction",
            "--routines",
            "--triggers",
            "--no-tablespaces",
        ]
        .map(String::from),
    );
    job.args.push(format!("--result-file={}", file.display()));
    job.args.push(endpoint.database.to_string());
    job
}

/// The dump read from stdin, as `mysql db < file` does. Not one transaction: DDL commits.
pub fn mysql(endpoint: &Endpoint, file: &Path) -> Job {
    let mut job = mysql_client("mysql", endpoint);
    job.args.push(format!("--database={}", endpoint.database));
    job.stdin = Some(file.to_path_buf());
    job
}

/// pg_dump's custom archives start with "PGDMP"; anything else is read as SQL.
pub fn is_pg_archive(file: &Path) -> Result<bool, AppError> {
    let mut magic = [0u8; 5];
    let read = std::fs::File::open(file)?.read(&mut magic)?;
    Ok(read == magic.len() && &magic == b"PGDMP")
}

fn postgres(program: &'static str, endpoint: &Endpoint) -> Job {
    let mut args = vec![
        format!("--host={}", endpoint.host),
        format!("--port={}", endpoint.port),
    ];
    if !endpoint.username.is_empty() {
        args.push(format!("--username={}", endpoint.username));
    }
    args.push(format!("--dbname={}", endpoint.database));
    // there is no terminal to type into: a missing password fails at once instead of waiting
    args.push("--no-password".into());

    let mode = match endpoint.tls.mode {
        TlsMode::Disable => "disable",
        TlsMode::Prefer => "prefer",
        TlsMode::Require => "require",
        TlsMode::VerifyFull => "verify-full",
    };
    let mut envs = vec![("PGSSLMODE", mode.to_string())];
    if let Some(ca) = &endpoint.tls.ca_cert_path {
        envs.push(("PGSSLROOTCERT", ca.clone()));
    }
    Job {
        program,
        args,
        envs,
        secret: endpoint
            .password
            .map(|password| ("PGPASSWORD", password.to_string())),
        stdin: None,
    }
}

// ponytail: the flags are Oracle MySQL's (--ssl-mode); a MariaDB client refuses them and its
// own error is shown, flagged as an option it does not know
fn mysql_client(program: &'static str, endpoint: &Endpoint) -> Job {
    let mut args = vec![
        format!("--host={}", endpoint.host),
        format!("--port={}", endpoint.port),
        // "localhost" would otherwise mean the unix socket, not the tunnel's port
        "--protocol=TCP".to_string(),
    ];
    if !endpoint.username.is_empty() {
        args.push(format!("--user={}", endpoint.username));
    }
    let mode = match endpoint.tls.mode {
        TlsMode::Disable => "DISABLED",
        TlsMode::Prefer => "PREFERRED",
        TlsMode::Require => "REQUIRED",
        TlsMode::VerifyFull => "VERIFY_IDENTITY",
    };
    args.push(format!("--ssl-mode={mode}"));
    if let Some(ca) = &endpoint.tls.ca_cert_path {
        args.push(format!("--ssl-ca={ca}"));
    }
    Job {
        program,
        args,
        envs: Vec::new(),
        // ponytail: MYSQL_PWD is deprecated in MySQL 8 but still read; an option file 0600
        // if a client stops reading it
        secret: endpoint
            .password
            .map(|password| ("MYSQL_PWD", password.to_string())),
        stdin: None,
    }
}

impl Job {
    /// The command as it could be typed in a terminal, with the TLS environment and
    /// without the password.
    pub fn command_line(&self) -> String {
        let mut words: Vec<String> = self
            .envs
            .iter()
            .map(|(name, value)| format!("{name}={}", shell_quote(value)))
            .collect();
        words.push(self.program.to_string());
        words.extend(self.args.iter().map(|arg| shell_quote(arg)));
        if let Some(file) = &self.stdin {
            words.push(format!("< {}", shell_quote(&file.display().to_string())));
        }
        words.join(" ")
    }

    /// Runs the tool to the end. `cancelled` is polled while it runs: when it says so,
    /// the tool is killed (a single-transaction restore then rolls back in the server).
    pub async fn run(&self, cancelled: impl Fn() -> bool) -> Result<(), AppError> {
        let mut command = Command::new(self.program);
        command
            .args(&self.args)
            .envs(self.envs.iter().map(|(name, value)| (name, value)))
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some((name, value)) = &self.secret {
            command.env(name, value);
        }
        command.stdin(match &self.stdin {
            Some(file) => Stdio::from(std::fs::File::open(file)?),
            None => Stdio::null(),
        });
        die_with_parent(&mut command);
        let mut child = command.spawn().map_err(|err| self.spawn_error(&err))?;

        // read while it runs: a full pipe would block the tool
        let mut pipe = child.stderr.take();
        let stderr = tokio::spawn(async move {
            let mut bytes = Vec::new();
            if let Some(pipe) = pipe.as_mut() {
                let _ = pipe.read_to_end(&mut bytes).await;
            }
            bytes
        });
        let status = loop {
            tokio::select! {
                status = child.wait() => break status?,
                () = tokio::time::sleep(POLL) => {
                    if cancelled() {
                        let _ = child.kill().await;
                        return Err(AppError::Cancelled(format!("{} cancelado", self.program)));
                    }
                }
            }
        };
        let stderr = stderr.await.unwrap_or_default();
        if status.success() {
            Ok(())
        } else {
            Err(self.failure(status, &String::from_utf8_lossy(&stderr)))
        }
    }

    fn spawn_error(&self, err: &std::io::Error) -> AppError {
        if err.kind() != std::io::ErrorKind::NotFound {
            return AppError::Database(format!("{}: {err}", self.program));
        }
        let package = if self.program.starts_with("mysql") {
            "o cliente do MySQL (pacote mysql-client)"
        } else {
            "o cliente do PostgreSQL (pacote postgresql-client), na versão do servidor ou mais nova"
        };
        AppError::Validation(format!(
            "{} não foi encontrado no PATH: instale {package}",
            self.program
        ))
    }

    fn failure(&self, status: ExitStatus, stderr: &str) -> AppError {
        let stderr = stderr.trim();
        let start = stderr.len().saturating_sub(STDERR_TAIL);
        let start = (start..stderr.len())
            .find(|&index| stderr.is_char_boundary(index))
            .unwrap_or(stderr.len());
        let tail = &stderr[start..];
        let detail = if tail.is_empty() {
            format!("saiu com {status}")
        } else {
            tail.to_string()
        };
        let lower = detail.to_lowercase();
        let hint = if lower.contains("version mismatch") {
            "versão incompatível: o cliente é mais antigo que o servidor; "
        } else if lower.contains("unknown option") || lower.contains("unknown variable") {
            "o cliente instalado não reconhece uma opção (cliente MariaDB ou versão antiga?); "
        } else {
            ""
        };
        AppError::Database(format!("{}: {hint}{detail}", self.program))
    }
}

/// Single quotes around anything a shell would split or expand.
fn shell_quote(word: &str) -> String {
    let plain = !word.is_empty()
        && word
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_@%+=:,./-".contains(c));
    if plain {
        word.to_string()
    } else {
        format!("'{}'", word.replace('\'', r"'\''"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tls(mode: TlsMode, ca: Option<&str>) -> TlsConfig {
        TlsConfig {
            mode,
            ca_cert_path: ca.map(String::from),
        }
    }

    fn endpoint(tls: &TlsConfig) -> Endpoint<'_> {
        Endpoint {
            host: "127.0.0.1",
            port: 40123,
            database: "app",
            username: "me",
            password: Some("s3cr'et"),
            tls,
        }
    }

    fn job(program: &'static str, args: &[&str]) -> Job {
        Job {
            program,
            args: args.iter().map(|arg| arg.to_string()).collect(),
            envs: Vec::new(),
            secret: None,
            stdin: None,
        }
    }

    #[test]
    fn postgres_commands_carry_tls_in_the_environment_and_never_the_password() {
        let tls = tls(TlsMode::VerifyFull, Some("/etc/ca dir/ca.pem"));
        let endpoint = endpoint(&tls);
        let dump = pg_dump(
            &endpoint,
            BackupFormat::Custom,
            Path::new("/tmp/b/app.dump.part"),
        )
        .unwrap();
        assert_eq!(
            dump.command_line(),
            "PGSSLMODE=verify-full PGSSLROOTCERT='/etc/ca dir/ca.pem' pg_dump --host=127.0.0.1 \
             --port=40123 --username=me --dbname=app --no-password --format=custom \
             --file=/tmp/b/app.dump.part"
        );
        assert_eq!(dump.secret, Some(("PGPASSWORD", "s3cr'et".to_string())));
        assert!(!dump.command_line().contains("s3cr"));
        assert!(!dump.args.iter().any(|arg| arg.contains("s3cr")));

        let plain = pg_dump(&endpoint, BackupFormat::Sql, Path::new("/b/app.sql")).unwrap();
        assert!(
            plain
                .command_line()
                .ends_with("--format=plain --clean --if-exists --no-owner --file=/b/app.sql")
        );
        assert!(pg_dump(&endpoint, BackupFormat::SqliteFile, Path::new("/b/x")).is_err());

        let restore = pg_restore(&endpoint, Path::new("/b/app.dump"));
        assert!(restore.command_line().contains(
            "pg_restore --host=127.0.0.1 --port=40123 --username=me --dbname=app --no-password \
             --clean --if-exists --no-owner --single-transaction --exit-on-error /b/app.dump"
        ));
        let script = psql(&endpoint, Path::new("/b/app.sql"));
        assert!(script.command_line().ends_with(
            "--no-psqlrc --quiet --single-transaction --set=ON_ERROR_STOP=1 --file=/b/app.sql"
        ));

        // no user: libpq's default (the OS user) instead of an empty name
        let anonymous = Endpoint {
            username: "",
            password: None,
            ..endpoint
        };
        let dump = pg_dump(&anonymous, BackupFormat::Custom, Path::new("/b/x")).unwrap();
        assert!(!dump.command_line().contains("--username"));
        assert_eq!(dump.secret, None);
    }

    #[test]
    fn mysql_commands_force_tcp_and_take_the_password_from_the_environment() {
        let tls = tls(TlsMode::Require, None);
        let endpoint = endpoint(&tls);
        let dump = mysqldump(&endpoint, Path::new("/b/app.sql.part"));
        assert_eq!(
            dump.command_line(),
            "mysqldump --host=127.0.0.1 --port=40123 --protocol=TCP --user=me \
             --ssl-mode=REQUIRED --single-transaction --routines --triggers --no-tablespaces \
             --result-file=/b/app.sql.part app"
        );
        assert_eq!(dump.secret, Some(("MYSQL_PWD", "s3cr'et".to_string())));

        let restore = mysql(&endpoint, Path::new("/b/my app.sql"));
        assert!(
            restore
                .command_line()
                .ends_with("--ssl-mode=REQUIRED --database=app < '/b/my app.sql'")
        );
        assert!(!restore.command_line().contains("s3cr"));
    }

    #[test]
    fn quotes_what_a_shell_would_split() {
        assert_eq!(shell_quote("--file=/a/b.sql"), "--file=/a/b.sql");
        assert_eq!(shell_quote("a b"), "'a b'");
        assert_eq!(shell_quote("it's"), r"'it'\''s'");
        assert_eq!(shell_quote(""), "''");
        assert_eq!(shell_quote("$HOME"), "'$HOME'");
    }

    #[test]
    fn recognizes_custom_archives() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("a.dump");
        let sql = dir.path().join("a.sql");
        let tiny = dir.path().join("tiny");
        std::fs::write(&archive, b"PGDMP\x01\x0e").unwrap();
        std::fs::write(&sql, b"-- PostgreSQL database dump").unwrap();
        std::fs::write(&tiny, b"PG").unwrap();
        assert!(is_pg_archive(&archive).unwrap());
        assert!(!is_pg_archive(&sql).unwrap());
        assert!(!is_pg_archive(&tiny).unwrap());
        assert!(is_pg_archive(&dir.path().join("missing")).is_err());
    }

    #[tokio::test]
    async fn a_missing_tool_says_what_to_install() {
        let err = job("pg_dump_que_nao_existe", &[])
            .run(|| false)
            .await
            .unwrap_err();
        let AppError::Validation(message) = err else {
            panic!("{err:?}")
        };
        assert!(message.contains("não foi encontrado no PATH"), "{message}");
        assert!(message.contains("postgresql-client"), "{message}");
    }

    #[tokio::test]
    async fn a_failing_tool_reports_its_stderr_with_a_hint() {
        let err = job(
            "sh",
            &[
                "-c",
                "echo 'aborting because of server version mismatch' >&2; exit 1",
            ],
        )
        .run(|| false)
        .await
        .unwrap_err();
        assert!(
            err.to_string()
                .starts_with("sh: versão incompatível: o cliente é mais antigo que o servidor"),
            "{err}"
        );
        let err = job("sh", &["-c", "exit 3"])
            .run(|| false)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("saiu com"), "{err}");
        job("sh", &["-c", "exit 0"]).run(|| false).await.unwrap();
    }

    #[tokio::test]
    async fn cancelling_kills_the_tool() {
        let started = std::time::Instant::now();
        let err = job("sleep", &["30"])
            .run(|| started.elapsed() > Duration::from_millis(200))
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Cancelled(_)), "{err:?}");
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[tokio::test]
    async fn the_password_reaches_the_tool_through_its_environment() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("env");
        let mut job = job(
            "sh",
            &[
                "-c",
                &format!("printf %s \"$PGPASSWORD\" > '{}'", out.display()),
            ],
        );
        job.secret = Some(("PGPASSWORD", "s3cret".into()));
        job.run(|| false).await.unwrap();
        assert_eq!(std::fs::read_to_string(out).unwrap(), "s3cret");
    }
}
