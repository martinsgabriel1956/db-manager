import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { Engine } from "@/bindings";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { ConnectionFormValues, FormErrors } from "@/features/connections/form";
import {
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
  isEditing: boolean;
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

export function ConnectionFields({
  values,
  errors,
  isEditing,
  onChange,
  onEngineChange
}: ConnectionFieldsProps) {
  const isSqlite = values.engine === "sqlite";
  const isRedis = values.engine === "redis";
  const isMongo = values.engine === "mongo";
  const isUri = isMongo && values.mongoMode === "uri";
  // TLS comes from the URI itself, and a file has none
  const hasTls = !isSqlite && !isUri;
  const advancedError = Boolean(errors.timeoutSecs || errors.caCertPath);

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
          {textInput("name", { placeholder: "ex.: Postgres prod" })}
        </Field>
      </div>

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
                isEditing
                  ? "Deixe vazio para manter a salva"
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
          <div className="grid grid-cols-[1fr_8rem] gap-4">
            <Field id="host" label="Host" error={errors.host}>
              {textInput("host")}
            </Field>
            <Field id="port" label="Porta" error={errors.port}>
              {textInput("port", { type: "number" })}
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field
              id="database"
              label={isRedis ? "Banco (0–15)" : "Banco de dados"}
              error={errors.database}
            >
              {textInput("database")}
            </Field>
            <Field id="username" label="Usuário" error={errors.username}>
              {textInput("username")}
            </Field>
          </div>
          <Field
            id="password"
            label="Senha"
            error={errors.password}
            hint="Guardada no keychain do sistema, não no arquivo de conexões."
          >
            <Input
              id="password"
              type="password"
              value={values.password}
              disabled={values.clearPassword}
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? "password-hint password-error" : "password-hint"}
              placeholder={isEditing ? "Deixe vazio para manter a senha salva" : ""}
              onChange={event => onChange({ password: event.target.value })}
            />
          </Field>
          {isEditing && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={values.clearPassword}
                onChange={event => onChange({ clearPassword: event.target.checked, password: "" })}
              />
              Remover senha salva
            </label>
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
              O próprio banco recusa escritas: sessão somente leitura no Postgres e no MySQL,
              arquivo aberto só para leitura no SQLite, só comandos de leitura no MongoDB e no
              Redis.
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
              <Field id="tlsMode" label="TLS">
                <NativeSelect
                  id="tlsMode"
                  className="w-full px-2.5"
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
