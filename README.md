# DB Manager

Cliente desktop (Tauri + React + Rust) para Postgres, MySQL, SQLite, MongoDB e Redis.
Decisões de design e marcos: [docs/decisions.md](docs/decisions.md).

## Pré-requisitos

- Rust stable (`~/.cargo/bin` no PATH), Node 24, pnpm (`corepack enable`)
- Linux: `libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libdbus-1-dev` e um Secret Service rodando (GNOME Keyring / KWallet) para guardar senhas
- Docker (testes de integração dos adapters, a partir do M1)

## Comandos

```bash
pnpm install
pnpm tauri dev            # app em modo dev (também regenera src/bindings.ts)
pnpm test:coverage        # front: Vitest, gate de 70%
pnpm typecheck
pnpm format

cd src-tauri
cargo test                # back: unitários + regenera src/bindings.ts
cargo test -- --ignored   # toca o keychain real do SO
cargo llvm-cov --ignore-filename-regex '(main|lib)\.rs$' --fail-under-lines 70
```

`src/bindings.ts` é gerado pelo `tauri-specta` a partir dos tipos Rust. Não edite à mão; o CI falha se estiver desatualizado.

## Onde ficam os dados

- Metadados das conexões: `~/.local/share/dev.nemomartins.dbmanager/connections.json`
- Senhas: keychain do SO, serviço `db-manager`, usuário = id da conexão
