use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};

use tokio::io::AsyncReadExt;
use tokio::net::TcpStream;
use tokio::process::{Child, Command};

use crate::domain::{AppError, SshConfig};

/// Login plus forward setup; the SSH handshake itself gives up after `ConnectTimeout`.
const READY_TIMEOUT: Duration = Duration::from_secs(20);
const POLL: Duration = Duration::from_millis(50);

/// Holds the SSH password for the askpass run of this same binary (see `askpass_reply`).
/// Set only on the ssh child, never on the app: it reaches ssh and what ssh spawns.
pub const ASKPASS_VAR: &str = "ORDO_SSH_ASKPASS_SECRET";

/// ssh asks for a password or passphrase by running `SSH_ASKPASS` with the prompt as
/// its argument; ours is the app binary itself, which then only prints this and exits.
pub fn askpass_reply() -> Option<String> {
    std::env::var(ASKPASS_VAR).ok()
}

/// A running `ssh -N -L` that forwards a local port to the database. Dropping it
/// kills the process.
pub struct SshTunnel {
    _child: Child,
    pub local_port: u16,
}

impl SshTunnel {
    /// Starts the system `ssh` and waits until the local port accepts connections,
    /// which OpenSSH only does after login and after the forward is set up.
    /// `password` answers ssh's password and passphrase prompts; without it, only keys
    /// and the agent, as before.
    pub async fn open(
        ssh: &SshConfig,
        host: &str,
        port: u16,
        password: Option<&str>,
    ) -> Result<Self, AppError> {
        let local_port = free_port()?;
        // the askpass is this very binary: main answers from ASKPASS_VAR and exits
        let exe = password
            .map(|_| std::env::current_exe())
            .transpose()
            .map_err(|err| tunnel_error(&err.to_string()))?;
        let mut command = command(ssh, local_port, host, port, exe.as_deref().zip(password));
        // kill_on_drop does not run when the app exits through process::exit or crashes:
        // the kernel ends ssh when its parent goes. The signal fires when the spawning
        // thread exits; these are the async runtime's workers, alive as long as the app.
        #[cfg(target_os = "linux")]
        // SAFETY: prctl is async-signal-safe and touches no memory of the parent.
        unsafe {
            command.pre_exec(|| {
                if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM) == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let mut child = command.spawn().map_err(|err| match err.kind() {
            std::io::ErrorKind::NotFound => {
                tunnel_error("o comando ssh não foi encontrado; instale o cliente OpenSSH")
            }
            _ => tunnel_error(&err.to_string()),
        })?;

        let deadline = Instant::now() + READY_TIMEOUT;
        loop {
            if let Some(status) = child
                .try_wait()
                .map_err(|err| tunnel_error(&err.to_string()))?
            {
                let mut stderr = String::new();
                if let Some(mut pipe) = child.stderr.take() {
                    let _ = pipe.read_to_string(&mut stderr).await;
                }
                let stderr = stderr.trim();
                return Err(tunnel_error(&if stderr.is_empty() {
                    format!("ssh saiu com {status}")
                } else {
                    stderr.to_string()
                }));
            }
            if TcpStream::connect(("127.0.0.1", local_port)).await.is_ok() {
                return Ok(Self {
                    _child: child,
                    local_port,
                });
            }
            if Instant::now() > deadline {
                return Err(tunnel_error(&format!(
                    "o túnel não ficou pronto em {} s",
                    READY_TIMEOUT.as_secs()
                )));
            }
            tokio::time::sleep(POLL).await;
        }
    }
}

fn tunnel_error(message: &str) -> AppError {
    AppError::Database(format!("túnel SSH: {message}"))
}

// ponytail: the port is released before ssh binds it, so another process may take it
// in between; ExitOnForwardFailure then makes ssh exit and the attempt fails clearly.
fn free_port() -> Result<u16, AppError> {
    std::net::TcpListener::bind(("127.0.0.1", 0))
        .and_then(|listener| listener.local_addr())
        .map(|addr| addr.port())
        .map_err(|err| tunnel_error(&format!("sem porta local livre: {err}")))
}

/// `askpass`: the program ssh runs for prompts and the password it answers with.
fn command(
    ssh: &SshConfig,
    local_port: u16,
    host: &str,
    port: u16,
    askpass: Option<(&Path, &str)>,
) -> Command {
    let mut command = Command::new("ssh");
    command
        .args(args(ssh, local_port, host, port, askpass.is_some()))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // never in the arguments, which any user can read in `ps`: the environment of a
    // process is readable only by its owner. "force" (OpenSSH 8.4+) uses the askpass
    // without a terminal or $DISPLAY
    if let Some((program, password)) = askpass {
        command
            .env("SSH_ASKPASS", program)
            .env("SSH_ASKPASS_REQUIRE", "force")
            .env(ASKPASS_VAR, password);
    }
    command
}

fn args(
    ssh: &SshConfig,
    local_port: u16,
    host: &str,
    port: u16,
    with_password: bool,
) -> Vec<String> {
    // ssh -L reads an IPv6 address only between brackets
    let host = if host.contains(':') {
        format!("[{host}]")
    } else {
        host.to_string()
    };
    let mut args: Vec<String> = [
        "-N",
        // without a password no prompt can be answered: keys and the agent only. With
        // one, a wrong password fails at once instead of being retried against the server
        "-o",
        if with_password {
            "NumberOfPasswordPrompts=1"
        } else {
            "BatchMode=yes"
        },
        "-o",
        "ExitOnForwardFailure=yes",
        // trust on first use; a changed key is still refused
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "ConnectTimeout=10",
        "-o",
        "ServerAliveInterval=30",
        "-o",
        "LogLevel=ERROR",
        "-L",
    ]
    .map(String::from)
    .into();
    args.push(format!("127.0.0.1:{local_port}:{host}:{port}"));
    if let Some(port) = ssh.port {
        args.extend(["-p".into(), port.to_string()]);
    }
    if let Some(user) = &ssh.user {
        args.extend(["-l".into(), user.clone()]);
    }
    if let Some(file) = &ssh.identity_file {
        args.extend(["-i".into(), file.clone()]);
    }
    // the host last, after "--": a value starting with "-" is never read as an option
    args.extend(["--".into(), ssh.host.clone()]);
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bastion() -> SshConfig {
        SshConfig {
            host: "bastion".into(),
            port: None,
            user: None,
            identity_file: None,
        }
    }

    #[test]
    fn empty_fields_are_left_to_the_ssh_config() {
        let args = args(&bastion(), 40000, "db.internal", 5432, false);
        assert!(args.contains(&"127.0.0.1:40000:db.internal:5432".to_string()));
        assert!(!args.iter().any(|a| a == "-p" || a == "-l" || a == "-i"));
        assert_eq!(args[args.len() - 2..], ["--", "bastion"]);
    }

    #[test]
    fn filled_fields_become_flags_and_ipv6_is_bracketed() {
        let ssh = SshConfig {
            port: Some(2222),
            user: Some("deploy".into()),
            identity_file: Some("/home/me/.ssh/id_ed25519".into()),
            ..bastion()
        };
        let args = args(&ssh, 40000, "::1", 5432, false).join(" ");
        assert!(args.contains("127.0.0.1:40000:[::1]:5432"));
        assert!(args.contains("-p 2222 -l deploy -i /home/me/.ssh/id_ed25519 -- bastion"));
    }

    #[test]
    fn a_password_goes_to_the_askpass_environment_never_to_the_arguments() {
        let askpass = Path::new("/opt/ordo/ordo");
        let with = command(&bastion(), 40000, "db", 5432, Some((askpass, "s3cret")));
        let without = command(&bastion(), 40000, "db", 5432, None);

        let args: Vec<_> = with.as_std().get_args().collect();
        assert!(!args.iter().any(|a| a.to_string_lossy().contains("s3cret")));
        assert!(args.contains(&"NumberOfPasswordPrompts=1".as_ref()));
        assert!(!args.contains(&"BatchMode=yes".as_ref()));
        let envs: Vec<_> = with.as_std().get_envs().collect();
        assert!(envs.contains(&("SSH_ASKPASS".as_ref(), Some(askpass.as_ref()))));
        assert!(envs.contains(&("SSH_ASKPASS_REQUIRE".as_ref(), Some("force".as_ref()))));
        assert!(envs.contains(&(ASKPASS_VAR.as_ref(), Some("s3cret".as_ref()))));

        // without a password nothing changes: batch mode, no askpass
        assert!(without.as_std().get_args().any(|a| a == "BatchMode=yes"));
        assert_eq!(without.as_std().get_envs().count(), 0);
    }

    #[tokio::test]
    async fn a_failing_ssh_reports_its_stderr() {
        let ssh = SshConfig {
            host: "nao-existe.invalid".into(),
            ..bastion()
        };
        let err = SshTunnel::open(&ssh, "db", 5432, None).await.err().unwrap();
        let AppError::Database(message) = err else {
            panic!("{err:?}")
        };
        assert!(message.starts_with("túnel SSH: "), "{message}");
        assert!(message.contains("nao-existe.invalid"), "{message}");
    }
}
