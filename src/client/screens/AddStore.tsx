import styled from "@emotion/styled";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ProviderId } from "../../core/store";
import { api } from "../api";
import { useConfig } from "../state";
import { Muted, Stack } from "../ui/layout";
import { Modal } from "../ui/Modal";
import {
  Button,
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
  max-width: 560px;
`;

const SourceRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
  min-height: 40px;
`;

const ProviderGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: ${({ theme }) => theme.space.sm}px;
`;

const REGIONS = ["us-east-1", "us-west-2", "eu-west-1", "eu-central-1", "ap-southeast-2"];

export function AddStore() {
  const navigate = useNavigate();
  const { refresh, accounts } = useConfig();
  const [view, setView] = useState<"list" | "add">("list");
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
      setView("list");
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
        {view === "list" ? (
          <Stack>
            <SourceRow>
              <span>This Computer</span>
              <Muted>local</Muted>
            </SourceRow>
            {accounts.length === 0 ? <Muted>No cloud sources yet.</Muted> : null}
            {accounts.map((account) => (
              <SourceRow key={account.id}>
                <span>
                  {account.displayName} · {account.region ?? account.provider} · secret {account.hasSecret ? "saved" : "missing"}
                </span>
                <Button variant="danger" onClick={() => void api().removeAccount(account.id).then(refresh)}>
                  Delete
                </Button>
              </SourceRow>
            ))}
            <Button variant="action" onClick={() => setView("add")}>
              Add
            </Button>
          </Stack>
        ) : null}
        {view === "add" ? (
          <>
        <ProviderGrid>
          {providers.map((item) => (
            <Button key={item.id} variant={provider === item.id ? "action" : "normal"} onClick={() => choose(item.id, item.available, item.label)}>
              {item.label}
            </Button>
          ))}
        </ProviderGrid>
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
              <Button variant="normal" onClick={() => setView("list")}>
                Back
              </Button>
            </div>
          </Stack>
        ) : null}
          </>
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
