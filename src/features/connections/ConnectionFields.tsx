import type { ReactNode } from "react";
import type { Engine } from "@/bindings";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  children: ReactNode;
};

const SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function Field({ id, label, error, children }: FieldProps) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
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

  function textInput(
    id: keyof ConnectionFormValues,
    props: { type?: string; placeholder?: string } = {}
  ) {
    return (
      <Input
        id={id}
        value={String(values[id])}
        aria-invalid={errors[id] ? true : undefined}
        aria-describedby={errors[id] ? `${id}-error` : undefined}
        onChange={event => onChange({ [id]: event.target.value })}
        {...props}
      />
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-4">
        <Field id="name" label="Nome" error={errors.name}>
          {textInput("name", { placeholder: "ex.: Postgres prod" })}
        </Field>
        <Field id="engine" label="Banco">
          <select
            id="engine"
            className={SELECT_CLASS}
            value={values.engine}
            onChange={event => onEngineChange(event.target.value as Engine)}
          >
            {ENGINES.map(engine => (
              <option key={engine} value={engine}>
                {ENGINE_LABEL[engine]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {isSqlite ? (
        <Field id="filePath" label="Arquivo" error={errors.filePath}>
          {textInput("filePath", { placeholder: "/caminho/para/banco.db" })}
        </Field>
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
              label={isRedis ? "Database (0–15)" : "Database"}
              error={errors.database}
            >
              {textInput("database")}
            </Field>
            <Field id="username" label="Usuário" error={errors.username}>
              {textInput("username")}
            </Field>
          </div>
          <Field id="password" label="Senha" error={errors.password}>
            <Input
              id="password"
              type="password"
              value={values.password}
              disabled={values.clearPassword}
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
          <div className="grid grid-cols-2 gap-4">
            <Field id="tlsMode" label="TLS">
              <select
                id="tlsMode"
                className={SELECT_CLASS}
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
              </select>
            </Field>
            <Field id="caCertPath" label="Certificado CA (opcional)">
              {textInput("caCertPath", { placeholder: "/caminho/para/ca.pem" })}
            </Field>
          </div>
        </>
      )}

      {isRedis && (
        <Field id="keySeparator" label="Separador de chaves" error={errors.keySeparator}>
          {textInput("keySeparator")}
        </Field>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field id="environment" label="Ambiente">
          <select
            id="environment"
            className={SELECT_CLASS}
            value={values.environment}
            onChange={event =>
              onChange({ environment: event.target.value as ConnectionFormValues["environment"] })
            }
          >
            {ENVIRONMENTS.map(environment => (
              <option key={environment} value={environment}>
                {ENVIRONMENT_STYLE[environment].label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="timeoutSecs" label="Timeout (s, 0 = sem limite)" error={errors.timeoutSecs}>
          {textInput("timeoutSecs", { type: "number" })}
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={values.readOnly}
          onChange={event => onChange({ readOnly: event.target.checked })}
        />
        Somente leitura
      </label>
    </div>
  );
}
