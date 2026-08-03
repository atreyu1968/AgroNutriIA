import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  getConversation,
  getGetConversationQueryKey,
  getListConversationsQueryKey,
  useCreateConversation,
  useGetConversation,
  useListConversations,
  useSendMessage,
  type Message,
} from '@workspace/api-client-react';
import { ErrorView, LoadingView } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import colors from '@/constants/colors';

type PendingMessage = {
  id: string;
  role: 'user';
  content: string;
};

type ChatItem = Message | PendingMessage;

function MessageBubble({ item }: { item: ChatItem }) {
  const c = useColors();
  const isUser = item.role === 'user';
  const sources = 'sources' in item ? item.sources : undefined;
  return (
    <View
      style={[
        styles.bubbleRow,
        { justifyContent: isUser ? 'flex-end' : 'flex-start' },
      ]}
    >
      <View
        style={[
          styles.bubble,
          isUser
            ? { backgroundColor: c.primary, borderBottomRightRadius: 4 }
            : {
                backgroundColor: c.card,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: c.border,
                borderBottomLeftRadius: 4,
              },
        ]}
      >
        <Text
          style={[
            styles.bubbleText,
            { color: isUser ? c.primaryForeground : c.foreground },
          ]}
        >
          {item.content}
        </Text>
        {sources && sources.length > 0 ? (
          <Text style={[styles.sources, { color: c.mutedForeground }]}>
            Fuentes: {sources.join(', ')}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export default function ChatScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const farmId = parseInt(id ?? '', 10);
  const queryClient = useQueryClient();

  const [conversationId, setConversationId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<PendingMessage | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const conversationsQuery = useListConversations(farmId, {
    query: {
      queryKey: getListConversationsQueryKey(farmId),
      enabled: !Number.isNaN(farmId),
    },
  });
  const createConversation = useCreateConversation();

  // Pick the most recent conversation once loaded (unless we created one).
  const activeConversationId = useMemo(() => {
    if (conversationId != null) return conversationId;
    const list = conversationsQuery.data;
    if (list && list.length > 0) {
      return [...list].sort(
        (a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime(),
      )[0].id;
    }
    return null;
  }, [conversationId, conversationsQuery.data]);

  const conversationQuery = useGetConversation(farmId, activeConversationId ?? 0, {
    query: {
      queryKey: getGetConversationQueryKey(farmId, activeConversationId ?? 0),
      enabled: !Number.isNaN(farmId) && activeConversationId != null,
    },
  });

  const sendMessage = useSendMessage();

  const messages: ChatItem[] = useMemo(() => {
    const server = conversationQuery.data?.messages ?? [];
    const all: ChatItem[] = pending ? [...server, pending] : [...server];
    return all.reverse(); // inverted FlatList
  }, [conversationQuery.data, pending]);

  const isSending = sendMessage.isPending || createConversation.isPending;

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || isSending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDraft('');
    setSendError(null);
    setPending({ id: `pending-${Date.now()}`, role: 'user', content });

    try {
      let convId = activeConversationId;
      if (convId == null) {
        const conv = await createConversation.mutateAsync({
          farmId,
          data: { title: content.slice(0, 60) },
        });
        convId = conv.id;
        setConversationId(conv.id);
      }
      await sendMessage.mutateAsync({
        farmId,
        conversationId: convId,
        data: { content },
      });
      // Refetch using the ACTUAL conversation id — `conversationQuery` may still
      // be bound to the previous (disabled) key when we just created the conversation.
      await queryClient.fetchQuery({
        queryKey: getGetConversationQueryKey(farmId, convId),
        queryFn: () => getConversation(farmId, convId as number),
      });
      await queryClient.invalidateQueries({
        queryKey: getListConversationsQueryKey(farmId),
      });
      setPending(null);
    } catch (err) {
      setPending(null);
      setDraft(content);
      const anyErr = err as { data?: { error?: string } };
      setSendError(anyErr?.data?.error ?? 'No se pudo enviar el mensaje. Inténtalo de nuevo.');
    }
  };

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;

  const isLoadingChat =
    conversationsQuery.isLoading ||
    (activeConversationId != null && conversationQuery.isLoading);

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <View style={[styles.header, { paddingTop: topInset + 8, borderBottomColor: c.border }]}>
        <Pressable
          testID="button-back"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.iconButton,
            { backgroundColor: c.secondary, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Feather name="arrow-left" size={18} color={c.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: c.foreground }]}>Técnico virtual</Text>
          <Text style={[styles.headerSub, { color: c.mutedForeground }]}>
            Pregunta sobre abonado, analíticas o manejo
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={0}>
        {conversationsQuery.isError ? (
          <ErrorView onRetry={() => conversationsQuery.refetch()} />
        ) : isLoadingChat ? (
          <LoadingView label="Cargando conversación…" />
        ) : (
          <FlatList
            data={messages}
            inverted
            keyExtractor={(item) => String(item.id)}
            scrollEnabled={messages.length > 0}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.messages}
            ListHeaderComponent={
              isSending ? (
                <View style={[styles.bubbleRow, { justifyContent: 'flex-start' }]}>
                  <View
                    style={[
                      styles.bubble,
                      {
                        backgroundColor: c.card,
                        borderWidth: StyleSheet.hairlineWidth,
                        borderColor: c.border,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                      },
                    ]}
                  >
                    <ActivityIndicator size="small" color={c.primary} />
                    <Text style={[styles.bubbleText, { color: c.mutedForeground }]}>
                      El técnico está escribiendo…
                    </Text>
                  </View>
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.emptyChat}>
                <Feather name="message-circle" size={32} color={c.mutedForeground} />
                <Text style={[styles.emptyTitle, { color: c.foreground }]}>
                  Habla con tu técnico virtual
                </Text>
                <Text style={[styles.emptySub, { color: c.mutedForeground }]}>
                  Por ejemplo: “¿Cómo va el potasio según la última analítica foliar?”
                </Text>
              </View>
            }
            renderItem={({ item }) => <MessageBubble item={item} />}
          />
        )}

        {sendError ? (
          <Text style={[styles.sendError, { color: c.destructive }]}>{sendError}</Text>
        ) : null}

        <View
          style={[
            styles.inputBar,
            {
              borderTopColor: c.border,
              backgroundColor: c.background,
              paddingBottom: bottomInset + 8,
            },
          ]}
        >
          <TextInput
            testID="input-message"
            style={[
              styles.input,
              { backgroundColor: c.card, borderColor: c.input, color: c.foreground },
            ]}
            placeholder="Escribe tu consulta…"
            placeholderTextColor={c.mutedForeground}
            value={draft}
            onChangeText={setDraft}
            multiline
            editable={!isSending}
          />
          <Pressable
            testID="button-send"
            accessibilityRole="button"
            disabled={!draft.trim() || isSending}
            onPress={handleSend}
            style={({ pressed }) => [
              styles.sendButton,
              {
                backgroundColor: c.primary,
                opacity: !draft.trim() || isSending ? 0.4 : pressed ? 0.8 : 1,
              },
            ]}
          >
            <Feather name="arrow-up" size={20} color={c.primaryForeground} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
  },
  headerSub: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messages: {
    padding: 16,
    gap: 10,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  bubbleRow: {
    flexDirection: 'row',
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleText: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    lineHeight: 21,
  },
  sources: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    marginTop: 6,
  },
  emptyChat: {
    alignItems: 'center',
    gap: 8,
    padding: 32,
    transform: [{ scaleY: -1 }],
  },
  emptyTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  emptySub: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
  sendError: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: colors.radius,
    paddingHorizontal: 14,
    paddingTop: 11,
    paddingBottom: 11,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
