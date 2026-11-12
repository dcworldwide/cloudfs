import styled from "@emotion/styled"
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import type { ProviderId, PublicAccount } from "../../core/store"
import { api } from "../api"
import { useConfig } from "../state"
import { AzureIcon, ComputerIcon, FtpIcon, GcsIcon, InfoIcon, S3Icon, TrashIcon } from "../ui/icons";
import { Muted, Stack } from "../ui/layout"
import { Modal } from "../ui/Modal"
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPopup,
  DialogTitle,
  FieldLabel,
  FieldRoot,
  Hint,
  IconButton,
  SwitchRoot,
  SwitchThumb,
  TextInput,
} from "../ui/primitives"

const Page = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space.lg}px;
`

const SourceList = styled.div`
  display: flex;
  flex-direction: column;
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius}px;
  overflow: hidden;
`

const SourceRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  min-height: 52px;
  padding-right: ${({ theme }) => theme.space.sm}px;
  & + & {
    border-top: 1px solid ${({ theme }) => theme.color.border};
  }
`

const Mark = styled.span`
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  background: ${({ theme }) => theme.color.bg};
`

const SectionLabel = styled.h2`
  margin: ${({ theme }) => theme.space.sm}px 0 0;
  color: ${({ theme }) => theme.color.muted};
  font: 600 11px ${({ theme }) => theme.font};
  letter-spacing: 0.08em;
  text-transform: uppercase;
`

const SourceButton = styled.button`
  width: 100%;
  min-width: 0;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: ${({ theme }) => theme.space.md}px;
  align-items: center;
  min-height: 52px;
  padding: 0 ${({ theme }) => theme.space.md}px;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  font: 500 14px ${({ theme }) => theme.font};
  &:hover {
    background: ${({ theme }) => theme.color.surfaceRaised};
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.color.primary};
    outline-offset: -2px;
  }
`

const SourceName = styled.span`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
`

const SourceMeta = styled.span`
  color: ${({ theme }) => theme.color.muted};
  font: 400 12px ${({ theme }) => theme.font};
`

const ProviderList = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(108px, 1fr));
  gap: ${({ theme }) => theme.space.sm}px;
`

const LabelRow = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
`;

const ProviderButton = styled(Button)`
  min-height: 84px;
  width: 100%;
  flex-direction: column;
  gap: 6px;
  padding: ${({ theme }) => theme.space.sm}px;
  font-size: 12px;
  line-height: 1.3;
  text-align: center;
`

function vendorIcon(id: ProviderId) {
  if (id === "s3") return <S3Icon />
  if (id === "azure") return <AzureIcon />
  if (id === "gcs") return <GcsIcon />
  if (id === "ftp") return <FtpIcon />
  return <ComputerIcon />
}

const VENDOR_NAME: Record<ProviderId, string> = {
  local: "This Computer",
  s3: "Amazon S3",
  azure: "Azure",
  gcs: "Google Cloud",
  ftp: "FTP",
}

const DEFAULT_REGION = "ap-southeast-2"
const REGIONS = [DEFAULT_REGION, "us-east-1", "us-west-2", "eu-west-1", "eu-central-1"]
const SESSION_TOKEN_HINT = `Run this in PowerShell:

aws iam list-mfa-devices --user-name {your_user_name-here}
aws sts get-session-token --serial-number {mfa-user-arn-here} --token-code {your MFA token here}
aws sts get-session-token --serial-number {mfa-user-arn-here} --token-code {your_mfa_token_here} --output json | ConvertFrom-Json`

type SourceDraft = {
  id?: string
  provider: ProviderId
  displayName: string
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  region: string
  ssl: boolean
  endpoint: string
  host: string
  port: string
  user: string
  password: string
  startDir: string
  hasSecret: boolean
  hasSessionToken: boolean
}

function emptyDraft(provider: ProviderId): SourceDraft {
  return {
    provider,
    displayName: "",
    accessKeyId: "",
    secretAccessKey: "",
    sessionToken: "",
    region: DEFAULT_REGION,
    ssl: true,
    endpoint: "",
    host: "",
    port: "21",
    user: "anonymous",
    password: "",
    startDir: "",
    hasSecret: false,
    hasSessionToken: false,
  }
}

function draftFromAccount(account: PublicAccount): SourceDraft {
  return {
    ...emptyDraft(account.provider),
    id: account.id,
    displayName: account.displayName,
    accessKeyId: account.accessKeyId ?? "",
    region: account.region ?? DEFAULT_REGION,
    ssl: account.ssl ?? true,
    endpoint: account.endpoint ?? "",
    host: account.host ?? "",
    port: String(account.port ?? 21),
    user: account.user ?? "anonymous",
    startDir: account.startDir ?? "",
    hasSecret: account.hasSecret,
    hasSessionToken: account.hasSessionToken,
  }
}

function SourceEditor({
  draft,
  onClose,
  onSaved,
}: {
  draft: SourceDraft
  onClose: () => void
  onSaved: () => void
}) {
  const [value, setValue] = useState(draft)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const editing = Boolean(draft.id)
  const input =
    value.provider === "ftp"
      ? {
        id: value.id,
        provider: "ftp" as const,
        displayName: value.displayName,
        host: value.host,
        port: Number(value.port) || 21,
        user: value.user,
        password: value.password,
        startDir: value.startDir,
      }
      : {
        id: value.id,
        provider: "s3" as const,
        displayName: value.displayName,
        accessKeyId: value.accessKeyId,
        secretAccessKey: value.secretAccessKey,
        sessionToken: value.sessionToken,
        region: value.region,
        ssl: value.ssl,
        endpoint: value.endpoint,
      }

  function set<K extends keyof SourceDraft>(key: K, next: SourceDraft[K]) {
    setValue((current) => ({ ...current, [key]: next }))
  }

  async function test() {
    setBusy(true)
    setMessage(null)
    try {
      await api().testAccount(input)
      setMessage("Connection succeeded.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection failed.")
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    setBusy(true)
    setMessage(null)
    try {
      await api().saveAccount(input)
      onSaved()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the store.")
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      nested
      onClose={onClose}
      title={editing ? value.displayName || "Source" : `Add ${VENDOR_NAME[value.provider]}`}
      description={editing ? "Saved credentials stay in place unless you replace them." : undefined}
    >
      <Stack>
        {value.provider === "ftp" ? (
          <>
            <FieldRoot>
              <FieldLabel>Display name</FieldLabel>
              <TextInput value={value.displayName} onChange={(event) => set("displayName", event.target.value)} />
            </FieldRoot>
            <FieldRoot>
              <FieldLabel>Host</FieldLabel>
              <TextInput placeholder="ftp.example.com" value={value.host} autoComplete="off" onChange={(event) => set("host", event.target.value)} />
            </FieldRoot>
            <FieldRoot>
              <FieldLabel>Port</FieldLabel>
              <TextInput value={value.port} onChange={(event) => set("port", event.target.value)} />
            </FieldRoot>
            <FieldRoot>
              <FieldLabel>User</FieldLabel>
              <TextInput value={value.user} autoComplete="off" onChange={(event) => set("user", event.target.value)} />
            </FieldRoot>
            <FieldRoot>
              <FieldLabel>Password</FieldLabel>
              <TextInput
                type="password"
                value={value.password}
                autoComplete="new-password"
                placeholder={value.hasSecret ? "Saved" : ""}
                onChange={(event) => set("password", event.target.value)}
              />
            </FieldRoot>
            <FieldRoot>
              <FieldLabel>Starting directory</FieldLabel>
              <TextInput placeholder="/" value={value.startDir} onChange={(event) => set("startDir", event.target.value)} />
            </FieldRoot>
          </>
        ) : (
          <>
            <FieldRoot>
              <FieldLabel>Display name</FieldLabel>
              <TextInput value={value.displayName} onChange={(event) => set("displayName", event.target.value)} />
            </FieldRoot>
            <FieldRoot>
              <FieldLabel>Access key</FieldLabel>
              <TextInput value={value.accessKeyId} autoComplete="off" onChange={(event) => set("accessKeyId", event.target.value)} />
            </FieldRoot>
            <FieldRoot>
              <FieldLabel>Secret</FieldLabel>
              <TextInput
                type="password"
                value={value.secretAccessKey}
                autoComplete="new-password"
                placeholder={value.hasSecret ? "Saved" : ""}
                onChange={(event) => set("secretAccessKey", event.target.value)}
              />
            </FieldRoot>
            <FieldRoot>
              <LabelRow>
                <FieldLabel>Session token (optional)</FieldLabel>
                <Hint label={SESSION_TOKEN_HINT} labelText="How to get a session token">
                  <InfoIcon />
                </Hint>
              </LabelRow>
              <TextInput
                type="password"
                value={value.sessionToken}
                autoComplete="new-password"
                placeholder={value.hasSessionToken ? "Saved" : "STS session token"}
                onChange={(event) => set("sessionToken", event.target.value)}
              />
            </FieldRoot>
            <FieldRoot>
              <FieldLabel>Region</FieldLabel>
              <TextInput list="regions" value={value.region} onChange={(event) => set("region", event.target.value)} />
              <datalist id="regions">
                {REGIONS.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </FieldRoot>
            <FieldRoot>
              <FieldLabel>SSL</FieldLabel>
              <SwitchRoot checked={value.ssl} onCheckedChange={(checked) => set("ssl", checked)}>
                <SwitchThumb />
              </SwitchRoot>
            </FieldRoot>
            <FieldRoot>
              <FieldLabel>Endpoint (optional)</FieldLabel>
              <TextInput placeholder="https://s3.example.com" value={value.endpoint} onChange={(event) => set("endpoint", event.target.value)} />
            </FieldRoot>
          </>
        )}
        {message ? <Muted>{message}</Muted> : null}
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="normal" disabled={busy} onClick={() => void test()}>
            Test connection
          </Button>
          <Button variant="action" disabled={busy} onClick={() => void save()}>
            Save source
          </Button>
        </div>
      </Stack>
    </Modal>
  )
}

export function AddStore() {
  const navigate = useNavigate()
  const { refresh, accounts, state } = useConfig()
  const windows = state.platform === "win32"
  const [providers, setProviders] = useState<{ id: ProviderId; label: string; available: boolean }[]>([])
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const [draft, setDraft] = useState<SourceDraft | null>(null)

  useEffect(() => {
    void api().providers().then(setProviders)
  }, [])

  function choose(id: ProviderId, available: boolean, label: string) {
    if (!available) {
      setUnavailable(label)
      return
    }
    setDraft(emptyDraft(id))
  }

  function openAccount(account: PublicAccount) {
    setDraft(draftFromAccount(account))
  }

  async function saved() {
    await refresh()
    setDraft(null)
  }

  return (
    <Modal
      open
      onClose={() => navigate("/")}
      title="Sources"
      description="View, add, or delete the stores saved on this computer."
    >
      <Page>
        <Stack>
          <SectionLabel>Saved on this computer</SectionLabel>
          <SourceList>
            <SourceRow>
              <SourceButton type="button" disabled>
                <Mark>
                  <ComputerIcon />
                </Mark>
                <SourceName>
                  {windows ? "This PC" : "This Computer"}
                  <SourceMeta>{windows ? "one source for each drive" : "local"}</SourceMeta>
                </SourceName>
              </SourceButton>
              <span />
            </SourceRow>
            {accounts.length === 0 ? (
              <SourceRow>
                <Muted style={{ padding: "0 12px" }}>No cloud sources yet.</Muted>
              </SourceRow>
            ) : null}
            {accounts.map((account) => (
              <SourceRow key={account.id}>
                <SourceButton type="button" title="View source" onClick={() => openAccount(account)}>
                  <Mark>{vendorIcon(account.provider)}</Mark>
                  <SourceName>
                    {account.displayName}
                    <SourceMeta>
                      {account.host ? `${account.host}${account.user ? ` · ${account.user}` : ""}` : account.region ?? account.provider}
                      {" · "}
                      {account.provider === "ftp" ? "password" : "secret"} {account.hasSecret ? "saved" : "none"}
                    </SourceMeta>
                  </SourceName>
                </SourceButton>
                <IconButton
                  title="Delete source"
                  aria-label={`Delete ${account.displayName}`}
                  variant="danger"
                  onClick={() => void api().removeAccount(account.id).then(refresh)}
                >
                  <TrashIcon />
                </IconButton>
              </SourceRow>
            ))}
          </SourceList>
          <SectionLabel>Add a source</SectionLabel>
          <ProviderList>
            {providers.map((item) => (
              <ProviderButton key={item.id} variant="normal" onClick={() => choose(item.id, item.available, item.label)}>
                {vendorIcon(item.id)}
                <span>{VENDOR_NAME[item.id]}</span>
                <SourceMeta>{item.available ? "" : "Soon"}</SourceMeta>
              </ProviderButton>
            ))}
          </ProviderList>
        </Stack>
        {draft ? <SourceEditor draft={draft} onClose={() => setDraft(null)} onSaved={() => void saved()} /> : null}
        <Dialog.Root open={unavailable != null} onOpenChange={(open) => !open && setUnavailable(null)}>
          <Dialog.Portal>
            <DialogBackdrop nested />
            <DialogPopup nested>
              <DialogTitle>{unavailable} is not available yet</DialogTitle>
              <DialogDescription>
                This version connects to Amazon S3 and S3-compatible endpoints. {unavailable} will use the same screens once its adapter is added. No credentials were collected.
              </DialogDescription>
              <Button onClick={() => setUnavailable(null)}>Close</Button>
            </DialogPopup>
          </Dialog.Portal>
        </Dialog.Root>
      </Page>
    </Modal>
  )
}
