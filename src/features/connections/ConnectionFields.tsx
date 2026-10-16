import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { Engine } from "@/bindings";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import {
  formatNodes,
  parseConnectionUrl,
  type ConnectionFormValues,
  type FormErrors
} from "@/features/connections/form";
import {
  DEFAULT_PORT,
  ENGINE_LABEL,
  ENGINES,
  ENVIRONMENT_STYLE,
  ENVIRONMENTS,
  TLS_LABEL,
  TLS_MODES
} from "@/features/connections/options";

type ConnectionFieldsProps = {
  values: ConnectionFormValues;
  errors: FormErrors;
  /** what an empty secret field keeps: the connection's own, or the original's on a copy */
  storedSecret: "own" | "copy" | null;
  /** the groups already in use, offered as the group field's suggestions */
  groups: string[];
  onChange: (patch: Partial<ConnectionFormValues>) => void;
  onEngineChange: (engine: Engine) => void;
};

type FieldProps = {
  id: keyof ConnectionFormValues;
  label: string;
  error?: string;
  /** answers what the field changes; wire it with describedBy(id, …) */
  hint?: string;
  children: ReactNode;
};

/** Error first (when present), then the hint: both read with the field. */
function describedBy(id: string, error: string | undefined, hint: boolean): string | undefined {
  const ids = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

/** What each environment changes, said where the environment is chosen. */
const ENVIRONMENT_HINT: Record<ConnectionFormValues["environment"], string> = {
  "": "Define as proteções desta conexão. Na dúvida entre dois, escolha o mais protegido.",
  local:
    "Banco na sua máquina. Comandos destrutivos (DROP, TRUNCATE, DELETE sem WHERE) pedem confirmação.",
  dev: "Banco de desenvolvimento compartilhado. Comandos destrutivos (DROP, TRUNCATE, DELETE sem WHERE) pedem confirmação.",
  staging:
    "Cópia de produção para testes, com as mesmas proteções de dev: comandos destrutivos (DROP, TRUNCATE, DELETE sem WHERE) pedem confirmação.",
  prod: "Faixa vermelha na janela inteira, e toda escrita mostra o comando exato e pede confirmação."
};

function Field({ id, label, error, hint, children }: FieldProps) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** How "somente leitura" is enforced, said for the engine being set up. */
const READ_ONLY_HINT: Record<Engine, string> = {
  postgres: "O próprio Postgres recusa escritas: a sessão abre em somente leitura.",
  mysql: "O próprio MySQL recusa escritas: a sessão abre com SESSION TRANSACTION READ ONLY.",
  sqlite: "O arquivo abre só para leitura (mode=ro): o próprio SQLite recusa escritas.",
  mongo: "Só comandos de leitura vão ao MongoDB: o app recusa escritas antes de enviá-las.",
  redis: "Só comandos de leitura vão ao Redis: o app recusa escritas antes de enviá-las."
};

export function ConnectionFields({
  values,
  errors,
  storedSecret,
  groups,
  onChange,
  onEngineChange
}: ConnectionFieldsProps) {
  const isSqlite = values.engine === "sqlite";
  const isRedis = values.engine === "redis";
  const isMongo = values.engine === "mongo";
  const isUri = isMongo && values.mongoMode === "uri";
  const isCluster = isRedis && values.redisMode === "cluster";
  // TLS comes from the URI itself, and a file has none
  const hasTls = !isSqlite && !isUri;
  const advancedError = Boolean(errors.timeoutSecs || errors.caCertPath || errors.tlsMode);

  function textInput(
    id: keyof ConnectionFormValues,
    props: { type?: string; placeholder?: string } = {}
  ) {
    return (
      <Input
        id={id}
        value={String(values[id])}
        aria-invalid={errors[id] ? true : undefined}
        aria-describedby={describedBy(id, errors[id], false)}
        onChange={event => onChange({ [id]: event.target.value })}
        {...props}
      />
    );
  }

  return (
    <div className="grid gap-4">
      {/* the engine reshapes every field below it, so it comes first */}
      <div className="grid grid-cols-2 gap-4">
        <Field id="engine" label="Tipo de banco">
          <NativeSelect
            id="engine"
            className="w-full px-2.5"
            value={values.engine}
            onChange={event => onEngineChange(event.target.value as Engine)}
          >
            {ENGINES.map(engine => (
              <option key={engine} value={engine}>
                {ENGINE_LABEL[engine]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="name" label="Nome" error={errors.name}>
          {textInput("name", { placeholder: `ex.: ${ENGINE_LABEL[values.engine]} prod` })}
        </Field>
      </div>
      <Field
        id="group"
        label="Grupo (opcional)"
        hint="Pasta na lateral: escolha uma existente ou digite um nome novo. Sem grupo, a conexão fica no topo."
      >
        <Input
          id="group"
          list="group-suggestions"
          autoComplete="off"
          value={values.group}
          aria-describedby="group-hint"
          onChange={event => onChange({ group: event.target.value })}
        />
        <datalist id="group-suggestions">
          {groups.map(group => (
            <option key={group} value={group} />
          ))}
        </datalist>
      </Field>

      {!isSqlite && !isMongo && !isCluster && (
        <UrlPaste onEngineChange={onEngineChange} onChange={onChange} />
      )}

      {isRedis && (
        <fieldset className="flex gap-4 text-sm">
          <legend className="sr-only">Topologia do Redis</legend>
          {(["standalone", "cluster"] as const).map(mode => (
            <label key={mode} className="flex items-center gap-1.5">
              <input
                type="radio"
                name="redisMode"
                checked={values.redisMode === mode}
                onChange={() =>
                  onChange({
                    redisMode: mode,
                    // the server already typed is the natural first seed
                    redisNodes:
                      values.redisNodes === "" && values.host !== ""
                        ? formatNodes([
                            { host: values.host, port: Number(values.port) || DEFAULT_PORT.redis }
                          ])
                        : values.redisNodes
                  })
                }
              />
              {mode === "standalone" ? "Servidor único" : "Cluster"}
            </label>
          ))}
        </fieldset>
      )}

      {isMongo && (
        <fieldset className="flex gap-4 text-sm">
          <legend className="sr-only">Forma de conexão</legend>
          {(["network", "uri"] as const).map(mode => (
            <label key={mode} className="flex items-center gap-1.5">
              <input
                type="radio"
                name="mongoMode"
                checked={values.mongoMode === mode}
                onChange={() => onChange({ mongoMode: mode })}
              />
              {mode === "network" ? "Host e porta" : "URI de conexão"}
            </label>
          ))}
        </fieldset>
      )}

      {isSqlite ? (
        <Field id="filePath" label="Arquivo" error={errors.filePath}>
          {textInput("filePath", { placeholder: "/caminho/para/banco.db" })}
        </Field>
      ) : isUri ? (
        <>
          <Field id="uri" label="URI de conexão" error={errors.uri}>
            <Input
              id="uri"
              type="password"
              autoComplete="off"
              value={values.uri}
              aria-invalid={errors.uri ? true : undefined}
              aria-describedby={errors.uri ? "uri-error" : undefined}
              placeholder={
                storedSecret === "own"
                  ? "Deixe vazio para manter a salva"
                  : storedSecret === "copy"
                    ? "Deixe vazio para copiar a da conexão original"
                    : "mongodb+srv://usuário:senha@cluster.exemplo.net/"
              }
              onChange={event => onChange({ uri: event.target.value })}
            />
          </Field>
          <p className="-mt-2 text-xs text-muted-foreground">
            Fica no keychain do sistema, como uma senha. TLS e autenticação vêm da própria URI.
          </p>
          <Field id="database" label="Banco padrão (opcional)" error={errors.database}>
            {textInput("database")}
          </Field>
        </>
      ) : (
        <>
          {isCluster ? (
            <Field
              id="redisNodes"
              label="Nós semente"
              error={errors.redisNodes}
              hint="host:porta, separados por vírgula. Um basta: os outros nós vêm dele. O cluster só tem o banco 0."
            >
              <Input
                id="redisNodes"
                value={values.redisNodes}
                placeholder="10.0.0.1:7000, 10.0.0.2:7000"
                aria-invalid={errors.redisNodes ? true : undefined}
                aria-describedby={describedBy("redisNodes", errors.redisNodes, true)}
                onChange={event => onChange({ redisNodes: event.target.value })}
              />
            </Field>
          ) : (
            <div className="grid grid-cols-[1fr_8rem] gap-4">
              <Field id="host" label="Host" error={errors.host}>
                {textInput("host")}
              </Field>
              <Field id="port" label="Porta" error={errors.port}>
                {textInput("port", { type: "number" })}
              </Field>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            {!isCluster && (
              <Field
                id="database"
                label={isRedis ? "Banco (0–15)" : "Banco de dados"}
                error={errors.database}
              >
                {textInput("database")}
              </Field>
            )}
            <Field id="username" label="Usuário" error={errors.username}>
              {textInput("username")}
            </Field>
          </div>
          <Field
            id="password"
            label="Senha"
            error={errors.password}
            hint="Guardada no keychain do sistema (no Linux, o Secret Service: GNOME Keyring ou KWallet), não no arquivo de conexões."
          >
            <Input
              id="password"
              type="password"
              value={values.password}
              disabled={values.clearPassword}
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? "password-hint password-error" : "password-hint"}
              placeholder={
                storedSecret === "own"
                  ? "Deixe vazio para manter a senha salva"
                  : storedSecret === "copy"
                    ? "Deixe vazio para copiar a senha da conexão original"
                    : ""
              }
              onChange={event => onChange({ password: event.target.value })}
            />
          </Field>
          {storedSecret && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={values.clearPassword}
                onChange={event => onChange({ clearPassword: event.target.checked, password: "" })}
              />
              {storedSecret === "own" ? "Remover senha salva" : "Não copiar a senha salva"}
            </label>
          )}
          {isCluster ? (
            <p className="text-xs text-muted-foreground">
              Sem túnel SSH no cluster: os nós anunciam os próprios endereços, e o túnel só alcança
              um host e porta.
            </p>
          ) : (
            <div className="grid gap-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={values.sshEnabled}
                  aria-describedby="sshEnabled-hint"
                  onChange={event => onChange({ sshEnabled: event.target.checked })}
                />
                Conectar por túnel SSH
              </label>
              <p id="sshEnabled-hint" className="pl-6 text-xs text-muted-foreground">
                Usa o ssh do sistema: valem o ~/.ssh/config, o agente e o known_hosts. Host e porta
                acima são vistos a partir do servidor SSH.
              </p>
            </div>
          )}
          {values.sshEnabled && !isCluster && (
            <>
              <div className="grid grid-cols-[1fr_8rem] gap-4">
                <Field id="sshHost" label="Host SSH" error={errors.sshHost}>
                  {textInput("sshHost", { placeholder: "bastion ou alias do ~/.ssh/config" })}
                </Field>
                <Field id="sshPort" label="Porta SSH" error={errors.sshPort}>
                  {textInput("sshPort", { type: "number", placeholder: "22" })}
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field id="sshUser" label="Usuário SSH (opcional)" error={errors.sshUser}>
                  {textInput("sshUser")}
                </Field>
                <Field id="sshIdentityFile" label="Chave privada (opcional)">
                  {textInput("sshIdentityFile", { placeholder: "~/.ssh/id_ed25519" })}
                </Field>
              </div>
              <Field
                id="sshPassword"
                label="Senha SSH ou passphrase da chave (opcional)"
                hint="Vai para o keychain, separada da senha do banco, e chega ao ssh só pelo ambiente do processo, nunca pela linha de comando. Vazia: só chave sem passphrase ou agente."
              >
                <Input
                  id="sshPassword"
                  type="password"
                  autoComplete="off"
                  value={values.sshPassword}
                  disabled={values.clearSshPassword}
                  aria-describedby="sshPassword-hint"
                  placeholder={
                    storedSecret === "own"
                      ? "Deixe vazio para manter a salva"
                      : storedSecret === "copy"
                        ? "Deixe vazio para copiar a da conexão original"
                        : ""
                  }
                  onChange={event => onChange({ sshPassword: event.target.value })}
                />
              </Field>
              {storedSecret && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={values.clearSshPassword}
                    onChange={event =>
                      onChange({ clearSshPassword: event.target.checked, sshPassword: "" })
                    }
                  />
                  {storedSecret === "own"
                    ? "Remover senha SSH salva"
                    : "Não copiar a senha SSH salva"}
                </label>
              )}
            </>
          )}
        </>
      )}

      {isRedis && (
        <Field id="keySeparator" label="Separador de chaves" error={errors.keySeparator}>
          {textInput("keySeparator")}
        </Field>
      )}

      {/* what guards this connection: chosen together, each one says what it changes */}
      <div
        role="group"
        aria-labelledby="protection-title"
        className="grid gap-4 border-t border-foreground pt-4"
      >
        <h3 id="protection-title" className="legend text-muted-foreground">
          Proteção
        </h3>
        <div className="grid grid-cols-2 items-start gap-4">
          <Field
            id="environment"
            label="Ambiente"
            hint={ENVIRONMENT_HINT[values.environment]}
            error={errors.environment}
          >
            <NativeSelect
              id="environment"
              className="w-full px-2.5"
              aria-invalid={errors.environment ? true : undefined}
              aria-describedby={describedBy("environment", errors.environment, true)}
              value={values.environment}
              onChange={event =>
                onChange({ environment: event.target.value as ConnectionFormValues["environment"] })
              }
            >
              {/* no default: the least protected regime must not be the silent choice */}
              <option value="" disabled>
                Escolha o ambiente
              </option>
              {ENVIRONMENTS.map(environment => (
                <option key={environment} value={environment}>
                  {ENVIRONMENT_STYLE[environment].label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid gap-1 pt-6">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={values.readOnly}
                aria-describedby="readOnly-hint"
                onChange={event => onChange({ readOnly: event.target.checked })}
              />
              Somente leitura
            </label>
            <p id="readOnly-hint" className="pl-6 text-xs text-muted-foreground">
              {READ_ONLY_HINT[values.engine]}
            </p>
          </div>
        </div>
      </div>

      {/* rarely changed: folded, but opened by itself when one of its fields has an error */}
      <details open={advancedError || undefined} className="group border-t border-foreground pt-4">
        <summary className="flex cursor-default items-center gap-1.5 legend text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronRight aria-hidden className="size-3.5 group-open:rotate-90" />
          Avançado
          <span className="font-sans text-xs font-normal tracking-normal normal-case">
            {hasTls ? "TLS, certificado e timeout" : "timeout"}
          </span>
        </summary>
        <div className="mt-4 grid gap-4">
          {hasTls && (
            <div className="grid grid-cols-2 gap-4">
              <Field id="tlsMode" label="TLS" error={errors.tlsMode}>
                <NativeSelect
                  id="tlsMode"
                  className="w-full px-2.5"
                  aria-invalid={errors.tlsMode ? true : undefined}
                  aria-describedby={describedBy("tlsMode", errors.tlsMode, false)}
                  value={values.tlsMode}
                  onChange={event =>
                    onChange({ tlsMode: event.target.value as ConnectionFormValues["tlsMode"] })
                  }
                >
                  {TLS_MODES.map(mode => (
                    <option key={mode} value={mode}>
                      {TLS_LABEL[mode]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="caCertPath" label="Certificado CA (opcional)">
                {textInput("caCertPath", { placeholder: "/caminho/para/ca.pem" })}
              </Field>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Field id="timeoutSecs" label="Timeout (s, 0 = sem limite)" error={errors.timeoutSecs}>
              {textInput("timeoutSecs", { type: "number" })}
            </Field>
          </div>
        </div>
      </details>
    </div>
  );
}

type UrlPasteProps = Pick<ConnectionFieldsProps, "onChange" | "onEngineChange">;

/**
 * Most connections arrive as a URL from a .env or a dashboard: pasted here, it fills the
 * fields below and leaves the input empty, so the password is kept only where the form
 * keeps it (the keychain, on save).
 */
function UrlPaste({ onChange, onEngineChange }: UrlPasteProps) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"filled" | "invalid" | null>(null);

  // applied whole: on paste, on Enter or on leaving the field, never on a typed prefix
  // ("postgres://a" already parses)
  function apply(candidate: string) {
    if (candidate.trim() === "") {
      setStatus(null);
      return;
    }
    const parsed = parseConnectionUrl(candidate);
    if (!parsed) {
      setText(candidate);
      setStatus("invalid");
      return;
    }
    onEngineChange(parsed.engine);
    onChange(parsed.patch);
    setText("");
    setStatus("filled");
  }

  return (
    <div className="grid gap-1.5">
      <Label htmlFor="connection-url">Colar URL de conexão (opcional)</Label>
      <Input
        id="connection-url"
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={text}
        placeholder="postgres://usuário:senha@host:5432/banco"
        aria-describedby="connection-url-status"
        aria-invalid={status === "invalid" ? true : undefined}
        onChange={event => {
          setText(event.target.value);
          setStatus(null);
        }}
        onPaste={event => {
          event.preventDefault();
          apply(event.clipboardData.getData("text"));
        }}
        onBlur={() => apply(text)}
        onKeyDown={event => {
          if (event.key === "Enter") {
            // Enter here fills the fields; it must not submit the form
            event.preventDefault();
            apply(text);
          }
        }}
      />
      <p
        id="connection-url-status"
        aria-live="polite"
        className={cn(
          "text-xs",
          status === "invalid" ? "text-destructive" : "text-muted-foreground"
        )}
      >
        {status === "filled"
          ? "Campos preenchidos a partir da URL. Confira abaixo; a senha vai para o keychain ao salvar."
          : status === "invalid"
            ? "Não reconheci a URL. Use postgres://, mysql:// ou redis://."
            : "Preenche tipo, host, porta, banco, usuário, senha e TLS de uma vez."}
      </p>
    </div>
  );
}
