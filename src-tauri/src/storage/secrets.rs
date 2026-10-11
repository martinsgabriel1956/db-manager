use crate::domain::AppError;

const SERVICE: &str = "db-manager";

/// Two implementations: the OS keychain in the app, an in-memory one in tests.
pub trait SecretStore: Send + Sync {
    fn set(&self, connection_id: &str, secret: &str) -> Result<(), AppError>;
    /// Deleting a secret that does not exist is not an error.
    fn delete(&self, connection_id: &str) -> Result<(), AppError>;
}

/// macOS Keychain / Windows Credential Manager / Linux Secret Service, via `keyring`.
pub struct OsKeychain;

impl SecretStore for OsKeychain {
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
    AppError::Keychain(err.to_string())
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
        assert_eq!(entry(id).unwrap().get_password().unwrap(), "pw");

        OsKeychain.delete(id).unwrap();
        assert!(matches!(
            entry(id).unwrap().get_password(),
            Err(keyring::Error::NoEntry)
        ));
        // deleting again is not an error
        OsKeychain.delete(id).unwrap();
    }
}
