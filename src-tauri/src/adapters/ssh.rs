use std::process::Stdio;
use std::time::{Duration, Instant};

use tokio::io::AsyncReadExt;
use tokio::net::TcpStream;
use tokio::process::{Child, Command};

use crate::domain::{AppError, SshConfig};

/// Login plus forward setup; the SSH handshake itself gives up after `ConnectTimeout`.
const READY_TIMEOUT: Duration = Duration::from_secs(20);
const POLL: Duration = Duration::from_millis(50);

/// A running `ssh -N -L` that forwards a local port to the database. Dropping it
/// kills the process.
pub struct SshTunnel {
    _child: Child,
    pub local_port: u16,
}

impl SshTunnel {
    /// Starts the system `ssh` and waits until the local port accepts connections,
    /// which OpenSSH only does after login and after the forward is set up.
    pub async fn open(ssh: &SshConfig, host: &str, port: u16) -> Result<Self, AppError> {
        let local_port = free_port()?;
        let mut command = Command::new("ssh");
        command
            .args(args(ssh, local_port, host, port))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
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

fn args(ssh: &SshConfig, local_port: u16, host: &str, port: u16) -> Vec<String> {
    // ssh -L reads an IPv6 address only between brackets
    let host = if host.contains(':') {
        format!("[{host}]")
    } else {
        host.to_string()
    };
    let mut args: Vec<String> = [
        "-N",
        // no prompt can be answered here: keys and the agent only
        "-o",
        "BatchMode=yes",
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
        let args = args(&bastion(), 40000, "db.internal", 5432);
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
        let args = args(&ssh, 40000, "::1", 5432).join(" ");
        assert!(args.contains("127.0.0.1:40000:[::1]:5432"));
        assert!(args.contains("-p 2222 -l deploy -i /home/me/.ssh/id_ed25519 -- bastion"));
    }

    #[tokio::test]
    async fn a_failing_ssh_reports_its_stderr() {
        let ssh = SshConfig {
            host: "nao-existe.invalid".into(),
            ..bastion()
        };
        let err = SshTunnel::open(&ssh, "db", 5432).await.err().unwrap();
        let AppError::Database(message) = err else {
            panic!("{err:?}")
        };
        assert!(message.starts_with("túnel SSH: "), "{message}");
        assert!(message.contains("nao-existe.invalid"), "{message}");
    }
}
