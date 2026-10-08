import styled from "@emotion/styled";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ProviderId } from "../../core/store";
import { api } from "../api";
import { useConfig } from "../state";
import { AzureIcon, ComputerIcon, GcsIcon, S3Icon, TrashIcon } from "../ui/icons";
import { Muted, Stack } from "../ui/layout";
import { Modal } from "../ui/Modal";
import {
  Button,
  IconButton,
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPopup,
  DialogTitle,
  FieldLabel,
  FieldRoot,
  SwitchRoot,
  SwitchThumb,
  TextInput,
} from "../ui/primitives";

const Page = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space.lg}px;
`;

const SourceList = styled.div`
  display: flex;
  flex-direction: column;
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius}px;
  overflow: hidden;
`;

const SourceRow = styled.div`
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  gap: ${({ theme }) => theme.space.md}px;
  align-items: center;
  min-height: 52px;
  padding: 0 ${({ theme }) => theme.space.md}px;
  & + & {
    border-top: 1px solid ${({ theme }) => theme.color.border};
  }
`;

const Mark = styled.span`
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  background: ${({ theme }) => theme.color.bg};
`;

const SectionLabel = styled.h2`
  margin: ${({ theme }) => theme.space.sm}px 0 0;
  color: ${({ theme }) => theme.color.muted};
  font: 600 11px ${({ theme }) => theme.font};
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const SourceName = styled.span`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
  font: 500 14px ${({ theme }) => theme.font};
`;

const SourceMeta = styled.span`
  color: ${({ theme }) => theme.color.muted};
  font: 400 12px ${({ theme }) => theme.font};
`;

const ProviderList = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: ${({ theme }) => theme.space.sm}px;
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
`;

function vendorIcon(id: ProviderId) {
  if (id === "s3") return <S3Icon />;
  if (id === "azure") return <AzureIcon />;
  if (id === "gcs") return <GcsIcon />;
  return <ComputerIcon />;
}

const VENDOR_NAME: Record<ProviderId, string> = {
  local: "This Computer",
  s3: "Amazon S3",
  azure: "Azure",
  gcs: "Google Cloud",
};

const REGIONS = ["us-east-1", "us-west-2", "eu-west-1", "eu-central-1", "ap-southeast-2"];

export function AddStore() {
  const navigate = useNavigate();
  const { refresh, accounts } = useConfig();
  const [providers, setProviders] = useState<{ id: ProviderId; label: string; available: boolean }[]>([]);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderId | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [region, setRegion] = useState("us-east-1");
  const [ssl, setSsl] = useState(true);
  const [endpoint, setEndpoint] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api().providers().then(setProviders);
  }, []);

  function choose(id: ProviderId, available: boolean, label: string) {
    if (!available) {
      setUnavailable(label);
      return;
    }
    setProvider(id);
  }

  const input = {
    provider: "s3" as const,
    displayName,
    accessKeyId,
    secretAccessKey,
    region,
    ssl,
    endpoint,
  };

  async function test() {
    setBusy(true);
    setMessage(null);
    try {
      await api().testAccount(input);
      setMessage("Connection succeeded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection failed.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await api().saveAccount(input);
      await refresh();
      setProvider(null);
      setDisplayName("");
      setAccessKeyId("");
      setSecretAccessKey("");
      setMessage("Source saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the store.");
      setBusy(false);
    }
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
            <Mark>
              <ComputerIcon />
            </Mark>
            <SourceName>This Computer</SourceName>
            <SourceMeta>local</SourceMeta>
          </SourceRow>
          {accounts.length === 0 ? (
            <SourceRow>
              <Mark />
              <Muted>No cloud sources yet.</Muted>
              <span />
            </SourceRow>
          ) : null}
          {accounts.map((account) => (
            <SourceRow key={account.id}>
              <Mark>{vendorIcon(account.provider)}</Mark>
              <SourceName>
                {account.displayName}
                <SourceMeta>
                  {account.region ?? account.provider} · secret {account.hasSecret ? "saved" : "missing"}
                </SourceMeta>
              </SourceName>
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
            <ProviderButton key={item.id} variant={provider === item.id ? "action" : "normal"} onClick={() => choose(item.id, item.available, item.label)}>
              {vendorIcon(item.id)}
              <span>{VENDOR_NAME[item.id]}</span>
              <SourceMeta>{item.available ? "" : "Soon"}</SourceMeta>
            </ProviderButton>
          ))}
        </ProviderList>
        {provider === "s3" ? (
          <Stack>
            <FieldRoot>
              <FieldLabel>Display name</FieldLabel>
              <TextInput value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </FieldRoot>
            <FieldRoot>
              <FieldLabel>Access key</FieldLabel>
              <TextInput value={accessKeyId} autoComplete="off" onChange={(event) => setAccessKeyId(event.target.value)} />
            </FieldRoot>
            <FieldRoot>
              <FieldLabel>Secret</FieldLabel>
              <TextInput type="password" value={secretAccessKey} autoComplete="new-password" onChange={(event) => setSecretAccessKey(event.target.value)} />
            </FieldRoot>
            <FieldRoot>
              <FieldLabel>Region</FieldLabel>
              <TextInput list="regions" value={region} onChange={(event) => setRegion(event.target.value)} />
              <datalist id="regions">
                {REGIONS.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </FieldRoot>
            <FieldRoot>
              <FieldLabel>SSL</FieldLabel>
              <SwitchRoot checked={ssl} onCheckedChange={setSsl}>
                <SwitchThumb />
              </SwitchRoot>
            </FieldRoot>
            <FieldRoot>
              <FieldLabel>Endpoint (optional)</FieldLabel>
              <TextInput placeholder="https://s3.example.com" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} />
            </FieldRoot>
            {message ? <Muted>{message}</Muted> : null}
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="normal" disabled={busy} onClick={() => void test()}>
                Test connection
              </Button>
              <Button variant="action" disabled={busy} onClick={() => void save()}>
                Save store
              </Button>
            </div>
          </Stack>
        ) : null}
      </Stack>
      <Dialog.Root open={unavailable != null} onOpenChange={(open) => !open && setUnavailable(null)}>
        <Dialog.Portal>
          <DialogBackdrop />
          <DialogPopup>
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
  );
}
