import { useState, useRef, useEffect } from "react";
import { useRoute, Link } from "wouter";
import { 
  useGetFarmSummary, 
  getGetFarmSummaryQueryKey,
  useListConversations, 
  useGetConversation, 
  useCreateConversation, 
  useSendMessage,
  getGetConversationQueryKey,
  getListConversationsQueryKey
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { 
  Sprout, Send, ArrowLeft, Plus, MessageSquare, 
  Settings, User, Bot, AlertCircle, Wrench, BookOpen 
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn, formatDateTime } from "@/lib/utils";

export default function TecnicoVirtual() {
  const [match, params] = useRoute("/fincas/:id/tecnico");
  const farmId = match && params.id ? parseInt(params.id, 10) : null;
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);

  const { data: summary, isLoading: isLoadingSummary } = useGetFarmSummary(farmId as number, { 
    query: { queryKey: getGetFarmSummaryQueryKey(farmId as number), enabled: !!farmId } 
  });

  const { data: conversations, isLoading: isLoadingConversations } = useListConversations(farmId as number, {
    query: { queryKey: getListConversationsQueryKey(farmId as number), enabled: !!farmId && !!summary?.aiAvailable }
  });

  useEffect(() => {
    if (conversations && conversations.length > 0 && !activeConversationId) {
      setActiveConversationId(conversations[0].id);
    }
  }, [conversations, activeConversationId]);

  if (!farmId) return <div>Finca no encontrada</div>;

  if (isLoadingSummary) return <Skeleton className="h-[80vh] w-full" />;
  if (!summary) return <div>Error al cargar contexto de finca</div>;

  const { farm } = summary;

  if (!summary.aiAvailable) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6 border-2 border-dashed rounded-xl bg-muted/10">
        <AlertCircle className="w-16 h-16 text-muted-foreground mb-4 opacity-50" />
        <h2 className="text-2xl font-bold mb-2">Técnico Virtual no configurado</h2>
        <p className="text-muted-foreground max-w-md mb-6">
          Para utilizar el asistente agronómico de IA, necesitas configurar tus credenciales de OpenAI en los ajustes de la finca o en tu perfil.
        </p>
        <div className="flex gap-4">
          <Button variant="outline" asChild>
            <Link href={`/fincas/${farmId}`}><ArrowLeft className="w-4 h-4 mr-2" /> Volver a la finca</Link>
          </Button>
          <Button asChild>
            <Link href="/ajustes"><Settings className="w-4 h-4 mr-2" /> Ir a Ajustes</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex items-center gap-4 mb-4">
        <Button variant="ghost" size="icon" className="shrink-0" asChild>
          <Link href={`/fincas/${farmId}`}>
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Técnico Agrícola Virtual</h1>
          <p className="text-sm text-muted-foreground">Finca: {farm.name}</p>
        </div>
      </div>

      <div className="flex flex-1 gap-6 overflow-hidden">
        {/* Left Panel: Context & History */}
        <div className="w-80 flex flex-col gap-4 hidden lg:flex">
          <Card className="flex-none bg-sidebar text-sidebar-foreground border-sidebar-border">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm flex items-center gap-2 text-sidebar-primary">
                <Sprout className="w-4 h-4" /> Contexto de IA
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-sidebar-foreground/60 text-xs block">Cultivo</span>
                  <span className="font-medium">{farm.mainCrop || 'Platanera'}</span>
                </div>
                <div>
                  <span className="text-sidebar-foreground/60 text-xs block">Fase</span>
                  <span className="font-medium">{farm.phenologicalStage || '-'}</span>
                </div>
                <div>
                  <span className="text-sidebar-foreground/60 text-xs block">Agua/sem</span>
                  <span className="font-medium">{summary.weeklyWaterM3 ? `${summary.weeklyWaterM3} m³` : '-'}</span>
                </div>
                <div>
                  <span className="text-sidebar-foreground/60 text-xs block">CE Max</span>
                  <span className="font-medium">{farm.maxEcDsM ? `${farm.maxEcDsM}` : '-'}</span>
                </div>
              </div>
              {summary.latestSoilAnalysis && (
                <div className="pt-2 border-t border-sidebar-border/50">
                  <span className="text-sidebar-foreground/60 text-xs block mb-1">Último Suelo ({summary.latestSoilAnalysis.sampleDate})</span>
                  <div className="text-xs font-mono bg-black/20 p-1.5 rounded text-sidebar-foreground/80">
                    {summary.latestSoilAnalysis.parameters.slice(0, 3).map(p => `${p.name}:${p.value}`).join(' ')}...
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="flex-1 flex flex-col overflow-hidden">
            <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium">Conversaciones</CardTitle>
              <NewConversationButton farmId={farmId} onCreated={setActiveConversationId} />
            </CardHeader>
            <CardContent className="flex-1 p-0 overflow-y-auto">
              {isLoadingConversations ? (
                <div className="p-4 space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : conversations?.length ? (
                <div className="flex flex-col">
                  {conversations.map(conv => (
                    <button
                      key={conv.id}
                      onClick={() => setActiveConversationId(conv.id)}
                      className={cn(
                        "text-left px-4 py-3 text-sm border-b last:border-0 hover:bg-muted/50 transition-colors flex items-start gap-3",
                        activeConversationId === conv.id ? "bg-muted border-l-2 border-l-primary" : "border-l-2 border-l-transparent"
                      )}
                    >
                      <MessageSquare className={cn("w-4 h-4 mt-0.5 shrink-0", activeConversationId === conv.id ? "text-primary" : "text-muted-foreground")} />
                      <div className="overflow-hidden">
                        <p className="font-medium truncate">{conv.title || "Nueva consulta"}</p>
                        <p className="text-xs text-muted-foreground mt-1">{formatDateTime(conv.createdAt)}</p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  No hay conversaciones previas.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Panel: Chat Interface */}
        <div className="flex-1 flex flex-col min-w-0 bg-card border rounded-xl overflow-hidden shadow-sm">
          {activeConversationId ? (
            <ChatInterface farmId={farmId} conversationId={activeConversationId} />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
              <Bot className="w-16 h-16 mb-4 opacity-20" />
              <p className="text-lg font-medium text-foreground">Inicia una nueva consulta</p>
              <p className="text-sm mt-1 mb-6 text-center max-w-md">
                Pregunta sobre planes de abonado, interpretación de analíticas o manejo del riego para esta finca.
              </p>
              <NewConversationButton farmId={farmId} onCreated={setActiveConversationId} showText size="lg" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NewConversationButton({ farmId, onCreated, showText = false, size = "icon" }: { farmId: number, onCreated: (id: number) => void, showText?: boolean, size?: "default" | "sm" | "lg" | "icon" }) {
  const queryClient = useQueryClient();
  const createConv = useCreateConversation({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey(farmId) });
        onCreated(data.id);
      }
    }
  });

  return (
    <Button 
      variant={showText ? "default" : "ghost"} 
      size={size}
      disabled={createConv.isPending}
      onClick={() => createConv.mutate({ farmId, data: { title: "Nueva consulta" } })}
    >
      <Plus className="w-4 h-4" />
      {showText && <span className="ml-2">Nueva Conversación</span>}
    </Button>
  );
}

function ChatInterface({ farmId, conversationId }: { farmId: number, conversationId: number }) {
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");

  const { data: detail, isLoading } = useGetConversation(farmId, conversationId, {
    query: { queryKey: getGetConversationQueryKey(farmId, conversationId), enabled: !!conversationId }
  });

  const sendMsg = useSendMessage({
    mutation: {
      onSuccess: (newMessages) => {
        // Optimistic update would be better, but refetching is safer for simplicity
        queryClient.invalidateQueries({ queryKey: getGetConversationQueryKey(farmId, conversationId) });
        setInput("");
      }
    }
  });

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [detail?.messages, sendMsg.isPending]);

  const handleSend = () => {
    if (!input.trim() || sendMsg.isPending) return;
    sendMsg.mutate({ farmId, conversationId, data: { content: input.trim() } });
  };

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><Skeleton className="h-[90%] w-[90%]" /></div>;
  if (!detail) return <div className="flex-1 flex items-center justify-center text-destructive">Error al cargar chat</div>;

  return (
    <>
      {/* Header */}
      <div className="h-14 border-b flex items-center px-4 shrink-0 bg-muted/30">
        <h3 className="font-medium truncate flex-1">{detail.conversation.title}</h3>
      </div>

      {/* Messages */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-6"
      >
        {detail.messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
            <Sprout className="w-12 h-12 mb-3 text-primary/30" />
            <p className="text-sm">Envía tu primera pregunta al asistente.</p>
          </div>
        ) : (
          detail.messages.map((msg, i) => (
            <div key={msg.id} className={cn("flex gap-4 max-w-3xl", msg.role === 'user' ? "ml-auto flex-row-reverse" : "mr-auto")}>
              <div className={cn(
                "w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-white",
                msg.role === 'user' ? "bg-secondary" : "bg-primary"
              )}>
                {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-5 h-5" />}
              </div>
              <div className="space-y-2 flex-1 min-w-0">
              <div className={cn(
                "p-4 rounded-2xl text-sm max-w-none break-words",
                msg.role === 'user' 
                  ? "bg-secondary/10 border border-secondary/20 text-foreground" 
                  : "bg-muted border border-border text-foreground"
              )}>
                {msg.content.split('\n').map((line, idx) => (
                  <span key={idx}>
                    {line}
                    <br />
                  </span>
                ))}
              </div>
                
                {msg.role === 'assistant' && (msg.toolsUsed?.length || msg.sources?.length) && (
                  <div className="flex flex-wrap gap-2 px-1">
                    {msg.toolsUsed?.map((tool, idx) => (
                      <Badge key={idx} variant="outline" className="text-[10px] bg-background text-muted-foreground flex gap-1 border-dashed">
                        <Wrench className="w-3 h-3" /> {tool}
                      </Badge>
                    ))}
                    {msg.sources?.map((source, idx) => (
                      <Badge key={idx} variant="secondary" className="text-[10px] bg-background text-muted-foreground flex gap-1">
                        <BookOpen className="w-3 h-3" /> {source}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        {sendMsg.isPending && (
          <div className="flex gap-4 max-w-3xl mr-auto animate-pulse">
            <div className="w-8 h-8 shrink-0 rounded-full bg-primary flex items-center justify-center text-white">
              <Bot className="w-5 h-5" />
            </div>
            <div className="bg-muted p-4 rounded-2xl w-24 h-12 flex items-center justify-center">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce delay-75" />
                <div className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce delay-150" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-4 border-t bg-background shrink-0">
        <form 
          className="flex gap-2 max-w-4xl mx-auto relative"
          onSubmit={(e) => { e.preventDefault(); handleSend(); }}
        >
          <Textarea 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Pregunta sobre la finca, cálculos de fertirriego..." 
            className="min-h-[60px] max-h-32 resize-none pr-14 pb-2 pt-3 rounded-xl border-muted-foreground/30 focus-visible:ring-primary"
          />
          <Button 
            type="submit" 
            size="icon" 
            disabled={!input.trim() || sendMsg.isPending}
            className="absolute right-2 bottom-2 rounded-lg"
          >
            <Send className="w-4 h-4" />
          </Button>
        </form>
        <p className="text-center text-[10px] text-muted-foreground mt-2">
          El técnico virtual puede cometer errores. Verifica siempre los cálculos y recomendaciones finales.
        </p>
      </div>
    </>
  );
}
