# Publicar uma versão

Uma tag `v*` dispara o workflow [Release](../.github/workflows/release.yml), que gera o `.deb`, o `.rpm` e o AppImage (Linux), o instalador `.exe` (Windows) e o `.dmg` (macOS, universal) e publica no GitHub Releases. Windows e macOS saem sem assinatura de código. A versão da tag precisa bater com a de `package.json` e `src-tauri/tauri.conf.json`; senão o workflow falha antes de compilar.

```bash
# depois de subir a versão nos dois arquivos e fazer o merge na main
git tag vX.Y.Z
git push origin vX.Y.Z
```

O release leva, além dos pacotes, um `.sig` de cada (assinatura do updater), o `latest.json` que o app consulta ao abrir e em "Procurar atualizações" (bandeja), e um `SHA256SUMS` dos pacotes (`sha256sum -c SHA256SUMS --ignore-missing` confere o que você baixou). O app atualiza sozinho todos esses formatos (o `.deb` e o `.rpm` pedem a senha de administrador pelo `pkexec`), sempre depois de você confirmar.

## Chave de assinatura

O updater só instala um pacote assinado pela chave cuja parte pública está em `plugins.updater.pubkey` do `src-tauri/tauri.conf.json`. A chave privada **nunca** entra no repositório: fica fora dele e nos secrets do GitHub.

```bash
pnpm tauri signer generate -w ~/.tauri/ordo.key
```

O comando pede uma senha e grava `~/.tauri/ordo.key` (privada) e `~/.tauri/ordo.key.pub` (pública). Depois:

1. Em **Settings → Secrets and variables → Actions** do repositório, crie `TAURI_SIGNING_PRIVATE_KEY` com o conteúdo de `~/.tauri/ordo.key` e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` com a senha.
2. A pública atual (id `90B7C4B184F0ED9A`) já está no `tauri.conf.json`; com um par novo, cole ali o conteúdo de `~/.tauri/ordo.key.pub` e faça o commit.
3. Guarde a chave privada e a senha num cofre: sem elas, as versões já instaladas não aceitam mais nenhuma atualização (trocar a chave obriga cada usuário a baixar a próxima versão à mão).

Sem o secret, o workflow falha antes de compilar.

## Testar sem publicar

Para testar os pacotes dos três sistemas, rode o workflow à mão: `gh workflow run Release --ref <branch>` (ou "Run workflow" na aba Actions). Ele só compila, sem tag, assinatura ou `latest.json`, e os pacotes ficam 7 dias como artefatos da execução (`gh run download <id>`).

## AUR

O pacote `ordo-db` ([packaging/aur/PKGBUILD](../packaging/aur/PKGBUILD)) compila do código da tag. A cada release, atualize `pkgver` e `sha256sums` (`updpkgsums`), gere o `.SRCINFO` com `makepkg --printsrcinfo > .SRCINFO` e faça o push dos dois arquivos no repositório `ssh://aur@aur.archlinux.org/ordo-db.git`.
