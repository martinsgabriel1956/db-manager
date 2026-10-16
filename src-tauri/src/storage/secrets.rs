use crate::domain::AppError;

// kept from the DB Manager days: renaming it would orphan every saved password
const SERVICE: &str = "db-manager";

/// The SSH tunnel's password or key passphrase, kept apart from the database's.
pub fn ssh_key(connection_id: &str) -> String {
    format!("{connection_id}:ssh")
}

/// Two implementations: the OS keychain in the app, an in-memory one in tests.
pub trait SecretStore: Send + Sync {
    /// None when no secret is stored for this connection.
    fn get(&self, connection_id: &str) -> Result<Option<String>, AppError>;
    fn set(&self, connection_id: &str, secret: &str) -> Result<(), AppError>;
    /// Deleting a secret that does not exist is not an error.
    fn delete(&self, connection_id: &str) -> Result<(), AppError>;
}

/// macOS Keychain / Windows Credential Manager / Linux Secret Service, via `keyring`.
pub struct OsKeychain;

impl SecretStore for OsKeychain {
    fn get(&self, connection_id: &str) -> Result<Option<String>, AppError> {
        match entry(connection_id)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(keychain_error(err)),
        }
    }

    fn set(&self, connection_id: &str, secret: &str) -> Result<(), AppError> {
        entry(connection_id)?
            .set_password(secret)
            .map_err(keychain_error)
    }

    fn delete(&self, connection_id: &str) -> Result<(), AppError> {
        match entry(connection_id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(keychain_error(err)),
        }
    }
}

fn entry(connection_id: &str) -> Result<keyring::Entry, AppError> {
    keyring::Entry::new(SERVICE, connection_id).map_err(keychain_error)
}

fn keychain_error(err: keyring::Error) -> AppError {
    AppError::keychain(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Hits the real OS keychain, so it needs a desktop session (Secret Service on Linux).
    /// Run with `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn os_keychain_set_then_delete() {
        let id = "db-manager-selftest";
        OsKeychain.set(id, "pw").unwrap();
        assert_eq!(OsKeychain.get(id).unwrap().as_deref(), Some("pw"));

        OsKeychain.delete(id).unwrap();
        assert_eq!(OsKeychain.get(id).unwrap(), None);
        // deleting again is not an error
        OsKeychain.delete(id).unwrap();
    }
}
