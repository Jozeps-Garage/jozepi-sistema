"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowSquareOut, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { Input } from "@/components/ui/input";
import { useBodyScrollLock } from "@/lib/utils/body-scroll-lock";
import { formatCurrency } from "@/lib/utils/format";
import { formatDocument } from "@/lib/utils/document";

export type NfseStatus = "queued" | "processing" | "issued" | "error" | "cancelled";

export interface NfseInvoice {
  invoiceId: string | null;
  status: NfseStatus;
  numero?: string | null;
  pdfUrl?: string | null;
  xmlUrl?: string | null;
  errorMessage?: string | null;
}

export interface NfseClientOption {
  id: string;
  name: string;
  document: string | null;
}

/** De quanto em quanto tempo perguntar à Notaas. A doc sugere 3 a 5 segundos. */
const POLL_MS = 4000;
/** Teto para não ficar perguntando para sempre se algo travar do outro lado. */
const POLL_LIMIT = 45;

const STATUS_LABEL: Record<NfseStatus, string> = {
  queued: "Na fila da prefeitura",
  processing: "Processando na prefeitura",
  issued: "Nota emitida",
  error: "A prefeitura recusou",
  cancelled: "Nota cancelada",
};

/**
 * Emissão da NFS-e de uma receita.
 *
 * A emissão é assíncrona: a Notaas aceita e devolve um id na hora, e a nota
 * fica pronta depois. Por isso o diálogo não fecha no "enviar" — ele passa a
 * acompanhar o status até sair de queued/processing, que é quando há algo de
 * fato para mostrar (o número da nota ou o motivo da recusa).
 */
export function NfseDialog({
  open,
  transactionId,
  description,
  amount,
  client,
  clientOptions,
  existing,
  onClose,
  onIssued,
}: {
  open: boolean;
  transactionId: string;
  description: string;
  amount: number;
  /** Tomador já conhecido, quando a receita veio de uma OS. */
  client: NfseClientOption | null;
  clientOptions: NfseClientOption[];
  existing: NfseInvoice | null;
  onClose: () => void;
  onIssued: (invoice: NfseInvoice) => void;
}) {
  // O pai remonta este componente por `key` a cada lançamento, então o estado
  // inicial é o certo sem precisar de um efeito de reset.
  const [clientId, setClientId] = useState(client?.id ?? "");
  const [servico, setServico] = useState(description);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<NfseInvoice | null>(existing);
  const pollsRef = useRef(0);

  useBodyScrollLock(open);

  const pending =
    invoice?.status === "queued" || invoice?.status === "processing";

  // Acompanha o andamento enquanto a nota não resolve.
  useEffect(() => {
    if (!open || !pending || !invoice?.invoiceId) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (pollsRef.current >= POLL_LIMIT) {
        if (!cancelled) {
          setError(
            "A prefeitura ainda não respondeu. A nota segue na fila — reabra daqui a pouco para ver o resultado."
          );
        }
        return;
      }
      pollsRef.current += 1;

      try {
        const response = await fetch(`/api/nfse/status/${invoice.invoiceId}`);
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setError(data.error ?? "Não foi possível consultar a nota.");
          return;
        }
        const next: NfseInvoice = {
          invoiceId: data.invoiceId ?? invoice.invoiceId,
          status: data.status,
          numero: data.numeroNfe ?? null,
          pdfUrl: data.pdfUrl ?? null,
          xmlUrl: data.xmlUrl ?? null,
          errorMessage: data.errorMessage ?? null,
        };
        setInvoice(next);
        if (next.status !== "queued" && next.status !== "processing") {
          onIssued(next);
        }
      } catch {
        if (!cancelled) setError("Falha de rede ao consultar a nota.");
      }
    }, POLL_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, pending, invoice, onIssued]);

  if (!open || typeof document === "undefined") return null;

  const chosen =
    client ?? clientOptions.find((option) => option.id === clientId) ?? null;
  const documentDigits = (chosen?.document ?? "").replace(/\D/g, "");
  const documentMissing =
    Boolean(chosen) && documentDigits.length !== 11 && documentDigits.length !== 14;

  function close() {
    if (sending) return;
    onClose();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (sending) return;

    if (!chosen) {
      setError("Escolha o cliente que é o tomador da nota.");
      return;
    }
    if (documentMissing) {
      setError(
        `${chosen.name} está sem CPF/CNPJ. Complete o cadastro do cliente antes de emitir.`
      );
      return;
    }
    if (!servico.trim()) {
      setError("Descreva o serviço prestado.");
      return;
    }

    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/nfse/emitir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId,
          clientId: chosen.id,
          descricao: servico.trim(),
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Não foi possível emitir a nota.");
        if (data.invoiceId) {
          setInvoice({ invoiceId: data.invoiceId, status: data.status ?? "queued" });
        }
        return;
      }

      const next: NfseInvoice = {
        invoiceId: data.invoiceId,
        status: data.status ?? "queued",
      };
      setInvoice(next);
      onIssued(next);
    } catch {
      setError("Falha de rede ao emitir a nota.");
    } finally {
      setSending(false);
    }
  }

  const issued = invoice?.status === "issued";

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-foreground/25 px-4 backdrop-blur-sm"
      onClick={close}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="nfse-dialog-title"
        onSubmit={handleSubmit}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg rounded-lg border border-border bg-card p-5 shadow-card-hover sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2
              id="nfse-dialog-title"
              className="text-lg font-semibold tracking-wide text-foreground"
            >
              Emitir NFS-e
            </h2>
            <p className="mt-1 text-sm text-muted">
              {formatCurrency(amount)} · a prefeitura leva alguns segundos.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-background hover:text-foreground"
            aria-label="Fechar"
          >
            <X size={16} weight="light" aria-hidden />
          </button>
        </div>

        {invoice ? (
          <div className="mt-4 space-y-3">
            <div
              className={`rounded-lg border px-4 py-3 ${
                issued
                  ? "border-success/30 bg-success/5"
                  : invoice.status === "error"
                    ? "border-danger/30 bg-danger/5"
                    : "border-border bg-background"
              }`}
            >
              <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                {pending && (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                )}
                {STATUS_LABEL[invoice.status]}
              </p>
              {invoice.numero && (
                <p className="mt-1 text-sm text-muted">
                  Número da nota: <strong className="text-foreground">{invoice.numero}</strong>
                </p>
              )}
              {invoice.errorMessage && (
                <p className="mt-1 text-sm text-danger">{invoice.errorMessage}</p>
              )}
            </div>

            {issued && (invoice.pdfUrl || invoice.xmlUrl) && (
              <div className="flex flex-wrap gap-2">
                {invoice.pdfUrl && (
                  <a
                    href={invoice.pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
                  >
                    <ArrowSquareOut size={14} weight="light" aria-hidden />
                    Abrir PDF
                  </a>
                )}
                {invoice.xmlUrl && (
                  <a
                    href={invoice.xmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
                  >
                    <ArrowSquareOut size={14} weight="light" aria-hidden />
                    Baixar XML
                  </a>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {client ? (
              <div className="rounded-lg border border-border bg-background px-4 py-3">
                <p className="label-caps">Tomador</p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {client.name}
                </p>
                <p className="text-xs text-muted">
                  {documentDigits
                    ? formatDocument(documentDigits)
                    : "sem CPF/CNPJ no cadastro"}
                </p>
              </div>
            ) : (
              <Dropdown
                label="Tomador"
                value={clientId}
                options={clientOptions.map((option) => ({
                  value: option.id,
                  label: option.document
                    ? `${option.name} · ${formatDocument(option.document)}`
                    : `${option.name} · sem CPF/CNPJ`,
                }))}
                onChange={setClientId}
                placeholder="Escolha o cliente"
              />
            )}

            {documentMissing && (
              <p className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-xs leading-relaxed text-warning">
                A prefeitura exige CPF ou CNPJ do tomador. Complete o cadastro
                de {chosen?.name} em Clientes e volte aqui.
              </p>
            )}

            <Input
              label="Descrição do serviço"
              value={servico}
              onChange={(event) => setServico(event.target.value)}
              placeholder="Higienização interna e polimento"
            />
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={close}
            disabled={sending}
            className="w-full sm:w-auto"
          >
            {invoice ? "Fechar" : "Cancelar"}
          </Button>
          {!invoice && (
            <Button
              type="submit"
              variant="success"
              loading={sending}
              disabled={documentMissing}
              className="w-full sm:w-auto"
            >
              Emitir nota
            </Button>
          )}
        </div>
      </form>
    </div>,
    document.body
  );
}
