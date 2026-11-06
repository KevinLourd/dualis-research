"use client";

import { Badge, Button, ClipboardText } from "@cloudflare/kumo";
import { CaretRightIcon, FolderIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { chooseOnedriveRoot, disconnectOnedrive, type FolderEntry, listOnedriveFolders, pollOnedriveLogin, startOnedriveLogin } from "./onedrive-actions";
import type { OnedriveStatus } from "./onedrive-queries";
import { Card } from "./ui";

/** Settings > OneDrive: sign in with a code, pick the research folder, then what we read and saved. */
export function OnedriveCard({ status }: { status: OnedriveStatus }) {
  const [picking, setPicking] = useState(false);
  const badge = !status.connected ? (
    <Badge appearance="dot" variant="neutral">Not connected</Badge>
  ) : !status.hasRoot ? (
    <Badge appearance="dot" variant="warning">Pick a folder</Badge>
  ) : status.lastError ? (
    <Badge appearance="dot" variant="warning">Needs attention</Badge>
  ) : (
    <Badge appearance="dot" variant="success">Connected</Badge>
  );
  return (
    <Card title="OneDrive research folder" action={badge}>
      <div className="flex flex-col gap-4 p-4 text-base text-kumo-default">
        {status.lastError && <p className="text-kumo-danger">{status.lastError}</p>}
        {!status.connected && <Connect />}
        {status.connected && (!status.hasRoot || picking) && <FolderPicker onDone={() => setPicking(false)} />}
        {status.connected && status.hasRoot && !picking && <Summary status={status} onChange={() => setPicking(true)} />}
      </div>
    </Card>
  );
}

function Connect() {
  const router = useRouter();
  const [code, setCode] = useState<{ userCode: string; verificationUri: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!code) return;
    const t = setInterval(async () => {
      const r = await pollOnedriveLogin();
      if (r.state === "connected") router.refresh();
      if (r.state === "failed") {
        setError(r.error);
        setCode(null);
      }
    }, 5000);
    return () => clearInterval(t);
  }, [code, router]);

  if (code)
    return (
      <div className="flex max-w-prose flex-col gap-3">
        <p className="font-medium text-kumo-strong">Sign in with your Duality Microsoft account</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Copy this code.</li>
          <li>
            Open{" "}
            <a className="text-kumo-link underline" href={code.verificationUri} target="_blank" rel="noreferrer">
              {code.verificationUri.replace(/^https:\/\//, "")}
            </a>{" "}
            and paste it.
          </li>
          <li>Sign in as your work account, then click Accept.</li>
        </ol>
        <ClipboardText text={code.userCode} size="base" className="max-w-56" />
        <p className="text-sm text-kumo-subtle">This page updates by itself once you accept. The code works for 15 minutes.</p>
      </div>
    );
  return (
    <div className="flex max-w-prose flex-col items-start gap-3">
      {error && <p className="text-kumo-danger">{error}</p>}
      <p>
        Connect your OneDrive so each thesis reads your research folder, and every new annual, half-year and quarterly report lands in the
        company&apos;s folder, inside a &quot;Filings (Dualis)&quot; subfolder. Dualis never deletes or replaces your files.
      </p>
      <Button
        variant="primary"
        loading={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            try {
              setCode(await startOnedriveLogin());
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          })
        }
      >
        Connect OneDrive
      </Button>
    </div>
  );
}

function FolderPicker({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [trail, setTrail] = useState<{ id: string | null; name: string }[]>([{ id: null, name: "My files" }]);
  const [folders, setFolders] = useState<FolderEntry[] | null>(null);
  const [current, setCurrent] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const here = trail[trail.length - 1];

  useEffect(() => {
    setFolders(null);
    listOnedriveFolders(here.id)
      .then((r) => {
        setCurrent(r.parent);
        setFolders(r.folders);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [here.id]);

  const path = "/" + trail.slice(1).map((t) => t.name).join("/");
  return (
    <div className="flex flex-col gap-3">
      <p className="font-medium text-kumo-strong">Which folder holds one folder per company?</p>
      <nav className="flex flex-wrap items-center gap-1 text-sm text-kumo-subtle">
        {trail.map((t, i) => (
          <span key={`${t.id}-${i}`} className="flex items-center gap-1">
            {i > 0 && <CaretRightIcon size={12} />}
            <button type="button" className="hover:text-kumo-strong" onClick={() => setTrail(trail.slice(0, i + 1))}>
              {t.name}
            </button>
          </span>
        ))}
      </nav>
      {error && <p className="text-kumo-danger">{error}</p>}
      <ul className="max-h-72 overflow-y-auto rounded-md border border-kumo-hairline">
        {folders === null && <li className="px-3 py-2 text-kumo-subtle">Loading folders...</li>}
        {folders?.length === 0 && <li className="px-3 py-2 text-kumo-subtle">No folder here.</li>}
        {folders?.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-kumo-tint"
              onClick={() => setTrail([...trail, { id: f.id, name: f.name }])}
            >
              <FolderIcon size={16} className="text-kumo-subtle" />
              <span className="flex-1">{f.name}</span>
              <span className="text-sm text-kumo-subtle">{f.childCount}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={!current || here.id === null}
          loading={pending}
          onClick={() =>
            start(async () => {
              await chooseOnedriveRoot(current!.id, path);
              onDone();
              router.refresh();
            })
          }
        >
          Use {here.id === null ? "this folder" : `"${here.name}"`}
        </Button>
      </div>
    </div>
  );
}

function Summary({ status, onChange }: { status: OnedriveStatus; onChange: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <p>
        Signed in as <span className="font-medium text-kumo-strong">{status.account}</span>. Research folder{" "}
        <span className="font-medium text-kumo-strong">{status.rootPath}</span>.
      </p>
      <dl className="grid max-w-xl grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <Stat label="Company folders" value={status.companyFolders} />
        <Stat label="Created by Dualis" value={status.createdFolders} />
        <Stat label="Documents read" value={status.documents} />
        <Stat label="Filings saved" value={status.savedFilings} />
      </dl>
      <p className="text-sm text-kumo-subtle">Updated with the daily collection. Files are only ever added, in each company&apos;s &quot;Filings (Dualis)&quot; folder.</p>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onChange}>
          Change folder
        </Button>
        <Button
          variant="secondary-destructive"
          loading={pending}
          onClick={() =>
            start(async () => {
              await disconnectOnedrive();
              router.refresh();
            })
          }
        >
          Disconnect
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <dt className="text-kumo-subtle">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums text-kumo-strong">{value.toLocaleString("en-US")}</dd>
    </div>
  );
}
