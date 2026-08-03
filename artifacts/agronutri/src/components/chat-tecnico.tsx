import { useState, useEffect, useRef } from "react";
import {
  useCreateConversation,
  useSendMessage,
  useUploadConversationAttachment,
  useListProductSheets,
  useDeleteProductSheet,
  getListFertilizersQueryKey,
  getListProductSheetsQueryKey,
  type Message,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Bot, Send, Globe, BookmarkPlus, ExternalLink, Trash2, Paperclip, FileText } from "lucide-react";

export function ChatTecnicoPanel({
  farmId,
  buildDraftContext,
  conversationTitle = "Chat con el técnico IA",
  description,
  allowAttachments = false,
  onConversationChange,
  compact = false,
}: {
  farmId: number;
  buildDraftContext?: () => string | null;
  conversationTitle?: string;
  description?: string;
  allowAttachments?: boolean;
  onConversationChange?: (id: number | null) => void;
  compact?: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: sheets } = useListProductSheets();
  const deleteSheet = useDeleteProductSheet({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: getListProductSheetsQueryKey() }),
    },
  });
  const createConversation = useCreateConversation();

  const setConv = (id: number) => {
    setConversationId(id);
    onConversationChange?.(id);
  };

  const ensureConversation = async (): Promise<number | null> => {
    if (conversationId) return conversationId;
    try {
      const conv = await createConversation.mutateAsync({
        farmId,
        data: { title: conversationTitle },
      });
      setConv(conv.id);
      return conv.id;
    } catch {
      toast({ title: "No se pudo iniciar la conversación", variant: "destructive" });
      return null;
    }
  };

  const sendMessage = useSendMessage({
    mutation: {
      onSuccess: (msgs) => {
        setMessages((prev) => [...prev.filter((m) => m.id > 0), ...msgs]);
        const assistant = msgs.find((m) => m.role === "assistant");
        if (assistant?.toolsUsed?.includes("ficha_guardada")) {
          queryClient.invalidateQueries({ queryKey: getListProductSheetsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListFertilizersQueryKey() });
          toast({
            title: "Ficha de producto guardada",
            description:
              "El técnico IA ha guardado una ficha; si trae composición, ya está en el catálogo de fertilizantes.",
          });
        }
      },
      onError: (err: unknown) => {
        setMessages((prev) => prev.filter((m) => m.id > 0));
        const msg = (err as { data?: { error?: string } })?.data?.error;
        toast({
          title: "No se pudo enviar el mensaje",
          description: msg ?? "Inténtalo de nuevo.",
          variant: "destructive",
        });
      },
    },
  });

  const uploadAttachment = useUploadConversationAttachment({
    mutation: {
      onSuccess: (msg) => {
        setMessages((prev) => [...prev, msg]);
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { error?: string } })?.data?.error;
        toast({
          title: "No se pudo adjuntar el archivo",
          description: msg ?? "Inténtalo de nuevo.",
          variant: "destructive",
        });
      },
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sendMessage.isPending, uploadAttachment.isPending]);

  const busy = sendMessage.isPending || createConversation.isPending || uploadAttachment.isPending;

  const handleSend = async () => {
    const content = text.trim();
    if (!content || busy) return;
    setText("");
    const optimisticId = -Date.now();
    setMessages((prev) => [
      ...prev,
      {
        id: optimisticId,
        conversationId: conversationId ?? 0,
        role: "user",
        content,
        createdAt: new Date().toISOString(),
      } as Message,
    ]);
    const convId = await ensureConversation();
    if (!convId) {
      setMessages((prev) => prev.filter((m) => m.id > 0));
      return;
    }
    sendMessage.mutate({
      farmId,
      conversationId: convId,
      data: { content, draftContext: buildDraftContext?.() ?? null },
    });
  };

  const handleFile = async (file: File | undefined) => {
    if (!file || busy) return;
    const convId = await ensureConversation();
    if (!convId) return;
    uploadAttachment.mutate({ farmId, conversationId: convId, data: { file } });
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Bot className="w-4 h-4 text-primary" /> Chat con el técnico IA
        </CardTitle>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1">
              <BookmarkPlus className="w-3.5 h-3.5" /> Fichas guardadas ({sheets?.length ?? 0})
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[70vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Fichas de productos guardadas</DialogTitle>
            </DialogHeader>
            {!sheets?.length ? (
              <p className="text-sm text-muted-foreground">
                Todavía no hay fichas. Pide al técnico IA que busque un producto en la web y la guarde.
              </p>
            ) : (
              <div className="space-y-3">
                {sheets.map((s) => (
                  <div key={s.id} className="rounded-md border p-3 text-sm space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">
                        {s.name}
                        {s.manufacturer && (
                          <span className="text-muted-foreground font-normal"> · {s.manufacturer}</span>
                        )}
                      </p>
                      <div className="flex items-center gap-1 shrink-0">
                        {s.fertilizerId != null && (
                          <Badge variant="secondary" className="text-[10px]">En catálogo</Badge>
                        )}
                        {s.category && (
                          <Badge variant="outline" className="text-[10px]">{s.category}</Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:bg-destructive/10"
                          onClick={() => deleteSheet.mutate({ sheetId: s.id })}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                    {s.description && <p className="text-muted-foreground text-xs">{s.description}</p>}
                    {s.composition && (
                      <p className="text-xs">
                        {(["nPct", "p2o5Pct", "k2oPct", "caoPct", "mgoPct", "so3Pct", "boronPct"] as const)
                          .map((k) => ({ k, v: s.composition?.[k] }))
                          .filter((e) => e.v != null)
                          .map(
                            (e) =>
                              `${{ nPct: "N", p2o5Pct: "P₂O₅", k2oPct: "K₂O", caoPct: "CaO", mgoPct: "MgO", so3Pct: "SO₃", boronPct: "B" }[e.k]} ${e.v}%`,
                          )
                          .join(" · ")}
                      </p>
                    )}
                    {s.dosage && <p className="text-xs text-muted-foreground">Dosis: {s.dosage}</p>}
                    {s.sourceUrl && (
                      <a
                        href={s.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-primary underline inline-flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" /> Ficha original
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-3">
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
        <div ref={scrollRef} className={`${compact ? "max-h-56" : "max-h-80"} overflow-y-auto space-y-3 pr-1`}>
          {messages.map((m, idx) => (
            <div key={`${m.id}-${idx}`} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`rounded-lg px-3 py-2 text-sm max-w-[85%] ${
                  m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                } ${m.attachments?.length ? "" : "whitespace-pre-wrap"}`}
              >
                {m.attachments?.length ? (
                  <span className="inline-flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 shrink-0" />
                    Adjunto: {m.attachments.join(", ")}
                  </span>
                ) : (
                  m.content
                )}
                {m.role === "assistant" && !!m.toolsUsed?.includes("busqueda_web") && (
                  <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Globe className="w-3 h-3" /> Con búsqueda web
                  </p>
                )}
                {m.role === "assistant" && !!m.sources?.filter((s) => s.startsWith("http")).length && (
                  <div className="mt-1 space-y-0.5">
                    {m.sources
                      .filter((s) => s.startsWith("http"))
                      .slice(0, 4)
                      .map((s, i) => (
                        <a
                          key={i}
                          href={s}
                          target="_blank"
                          rel="noreferrer"
                          className="block text-[10px] text-primary underline truncate"
                        >
                          {s}
                        </a>
                      ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {uploadAttachment.isPending && (
            <div className="flex justify-end">
              <div className="rounded-lg px-3 py-2 text-sm bg-primary/70 text-primary-foreground animate-pulse">
                Procesando el archivo adjunto...
              </div>
            </div>
          )}
          {sendMessage.isPending && (
            <div className="flex justify-start">
              <div className="rounded-lg px-3 py-2 text-sm bg-muted text-muted-foreground animate-pulse">
                El técnico IA está pensando (puede tardar si busca en la web)...
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-2 items-end">
          {allowAttachments && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  void handleFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <Button
                variant="outline"
                size="icon"
                className="shrink-0"
                title="Adjuntar PDF o imagen"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                <Paperclip className="w-4 h-4" />
              </Button>
            </>
          )}
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={
              allowAttachments
                ? 'Ej: "Incluye en el informe las observaciones de la visita" (puedes adjuntar PDF e imágenes)'
                : 'Ej: "Busca la ficha del Hakaphos Verde y guárdala" o "¿Subo el potasio en fase de engorde?"'
            }
            rows={2}
            className="resize-none"
          />
          <Button onClick={handleSend} disabled={busy || !text.trim()} size="icon" className="shrink-0">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
