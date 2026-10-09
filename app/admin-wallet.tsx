import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { router } from "expo-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PlayerAvatar } from "@/components/player/PlayerAvatar";
import type { AvatarId } from "@/types/avatar";

import {
  MOBILE_HORIZONTAL_INSET,
  TABLET_HORIZONTAL_INSET,
} from "@/constants/layout";
import { useProfile } from "@/lib/profile";
import { getAuthState, hasReadySession, useAuthState } from "@/lib/auth-state";
import { supabase } from "@/lib/supabase";
import { useWallet } from "@/lib/wallet-context";

type Currency = "MC" | "Coin" | "Gem";
type Tab = "send" | "received" | "sent";

type Player = {
  id: string;
  username: string;
  player_id: string;
};

type RecentRecipient = {
  player: Player & { avatar_id: string | null; avatar_url: string | null };
  amount: number;
  currency: Currency;
};

type HistoryPlayer = Player & { avatar_id: string | null; avatar_url: string | null };

type Transfer = {
  id: string;
  from_user_id: string | null;
  to_user_id: string | null;
  amount: number;
  currency: Currency;
  created_at: string;
};

const currencies: {
  value: Currency;
  label: string;
}[] = [
  {
    value: "MC",
    label: "Aznif",
  },
  {
    value: "Coin",
    label: "Coin",
  },
  {
    value: "Gem",
    label: "Gem",
  },
];

const quickAmounts: Record<Currency, number[]> = {
  MC: [
    5000,
    10000,
    15000,
    20000,
    25000,
    30000,
    35000,
    40000,
    45000,
    50000,
  ],
  Coin: [
    5000,
    10000,
    15000,
    20000,
    25000,
    30000,
    35000,
    40000,
    45000,
    50000,
  ],
  Gem: [
    100,
    200,
    300,
    400,
    500,
    600,
    700,
    800,
    900,
    1000,
  ],
};

function currencyLabel(currency: Currency) {
  return currency === "MC" ? "Aznif" : currency;
}

export default function AdminWalletScreen() {
  const { profile, loading } = useProfile();
  const auth = useAuthState();
  const { wallet, refreshWallet } = useWallet();
  const currentAccountId =
    hasReadySession(auth) && profile?.id === auth.userId
      ? profile.id
      : null;

  return (
    <AdminWalletContent
      key={currentAccountId ?? "no-account"}
      profile={profile}
      loading={loading}
      auth={auth}
      wallet={wallet}
      refreshWallet={refreshWallet}
      currentAccountId={currentAccountId}
    />
  );
}

function AdminWalletContent({
  profile,
  loading,
  auth,
  wallet,
  refreshWallet,
  currentAccountId,
}: {
  profile: ReturnType<typeof useProfile>["profile"];
  loading: ReturnType<typeof useProfile>["loading"];
  auth: ReturnType<typeof useAuthState>;
  wallet: ReturnType<typeof useWallet>["wallet"];
  refreshWallet: ReturnType<typeof useWallet>["refreshWallet"];
  currentAccountId: string | null;
}) {
  const { width, height } = useWindowDimensions();
  const isTablet = Math.min(width, height) >= 600;

  const horizontalInset = isTablet
    ? TABLET_HORIZONTAL_INSET
    : MOBILE_HORIZONTAL_INSET;

  const [tab, setTab] = useState<Tab>("send");

  const [search, setSearch] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [selected, setSelected] =
    useState<Player | null>(null);

  const [currency, setCurrency] =
    useState<Currency>("MC");

  const [amount, setAmount] = useState("");

  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");

  const [sentHistory, setSentHistory] = useState<
    Transfer[]
  >([]);

  const [receivedHistory, setReceivedHistory] =
    useState<Transfer[]>([]);

  const [recentRecipients, setRecentRecipients] = useState<RecentRecipient[]>([]);

  const [historyPlayers, setHistoryPlayers] = useState<
    Record<string, HistoryPlayer>
  >({});
  const [historyAccountId, setHistoryAccountId] = useState<string | null>(null);
  const historyRequestRef = useRef(0);
  const sendRequestRef = useRef(0);
  const currentAccountIdRef = useRef(currentAccountId);

  const canAccessAdminWallet =
    profile?.isAdmin === true || profile?.isFinanceAdmin === true;

  const currentWallet =
    currentAccountId && wallet?.user_id === currentAccountId
      ? wallet
      : null;

  const balances = useMemo(
    () => ({
      MC: currentWallet?.balances.mc ?? 0,
      Coin: currentWallet?.balances.coin ?? 0,
      Gem: currentWallet?.balances.gem ?? 0,
    }),
    [currentWallet],
  );

  const currentBalance = balances[currency];
  const visibleSentHistory = historyAccountId === currentAccountId ? sentHistory : [];
  const visibleReceivedHistory = historyAccountId === currentAccountId ? receivedHistory : [];

  useEffect(() => {
    currentAccountIdRef.current = currentAccountId;
    return () => {
      currentAccountIdRef.current = null;
      historyRequestRef.current += 1;
      sendRequestRef.current += 1;
    };
  }, [currentAccountId]);

  const isCurrentHistoryRequest = useCallback(
    (accountId: string, requestId: number) =>
      currentAccountIdRef.current === accountId &&
      getAuthState().userId === accountId &&
      historyRequestRef.current === requestId,
    [],
  );

  const loadHistoryPlayers = useCallback(
    async (transfers: Transfer[], accountId: string, requestId: number) => {
      const ids = [
        ...new Set(
          transfers
            .flatMap((item) => [
              item.from_user_id,
              item.to_user_id,
            ])
            .filter(
              (id): id is string => Boolean(id),
            ),
        ),
      ];

      if (ids.length === 0) {
        if (isCurrentHistoryRequest(accountId, requestId)) setHistoryPlayers({});
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, player_id, avatar_id, avatar_url")
        .in("id", ids);

      if (!isCurrentHistoryRequest(accountId, requestId)) return;

      if (error) {
        setMessage(error.message);
        return;
      }

      setHistoryPlayers(
        Object.fromEntries(
          (data ?? []).map((item) => [
            item.id,
            item,
          ]),
        ),
      );
    },
    [isCurrentHistoryRequest],
  );

  const loadRecentRecipients = useCallback(async (accountId: string, requestId: number) => {
    const latestByPlayer = new Map<string, { amount: number; currency: Currency }>();
    const batchSize = 25;
    let offset = 0;

    while (latestByPlayer.size < 3) {
      const { data, error } = await supabase
        .from("wallet_transactions")
        .select("to_user_id, amount, currency")
        .eq("user_id", accountId)
        .eq("from_user_id", accountId)
        .eq("transaction_type", "distribution_debit")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + batchSize - 1);

      if (!isCurrentHistoryRequest(accountId, requestId)) return;
      if (error) { setMessage(error.message); return; }

      for (const transfer of data ?? []) {
        if (transfer.to_user_id && !latestByPlayer.has(transfer.to_user_id)) {
          latestByPlayer.set(transfer.to_user_id, {
            amount: Number(transfer.amount),
            currency: transfer.currency as Currency,
          });
          if (latestByPlayer.size === 3) break;
        }
      }
      if ((data ?? []).length < batchSize) break;
      offset += batchSize;
    }

    const ids = [...latestByPlayer.keys()];
    if (ids.length === 0) { setRecentRecipients([]); return; }
    const { data: profiles, error } = await supabase
      .from("profiles")
      .select("id, username, player_id, avatar_id, avatar_url")
      .in("id", ids);
    if (!isCurrentHistoryRequest(accountId, requestId)) return;
    if (error) { setMessage(error.message); return; }

    const profilesById = new Map((profiles ?? []).map((player) => [player.id, player]));
    setRecentRecipients(ids.flatMap((id) => {
      const player = profilesById.get(id);
      const transfer = latestByPlayer.get(id);
      return player && transfer ? [{ player, ...transfer }] : [];
    }));
  }, [isCurrentHistoryRequest]);

  const loadHistory = useCallback(
    async (adminId: string) => {
      if (currentAccountIdRef.current !== adminId || getAuthState().userId !== adminId) return;
      const requestId = ++historyRequestRef.current;
      const [sentResult, receivedResult] =
        await Promise.all([
          supabase
            .from("wallet_transactions")
            .select(
              "id, from_user_id, to_user_id, amount, currency, created_at",
            )
            .eq("user_id", adminId)
            .eq("from_user_id", adminId)
            .order("created_at", {
              ascending: false,
            })
            .limit(20),

          supabase
            .from("wallet_transactions")
            .select(
              "id, from_user_id, to_user_id, amount, currency, created_at",
            )
            .eq("user_id", adminId)
            .eq("to_user_id", adminId)
            .not("from_user_id", "is", null)
            .order("created_at", {
              ascending: false,
            })
            .limit(20),
        ]);

      if (!isCurrentHistoryRequest(adminId, requestId)) return;

      if (sentResult.error) {
        setMessage(sentResult.error.message);
        return;
      }

      if (receivedResult.error) {
        setMessage(receivedResult.error.message);
        return;
      }

      const sent =
        (sentResult.data ?? []) as Transfer[];

      const received =
        (receivedResult.data ?? []) as Transfer[];

      setSentHistory(sent);
      setReceivedHistory(received);
      setHistoryAccountId(adminId);

      await Promise.all([
        loadHistoryPlayers([...sent, ...received], adminId, requestId),
        loadRecentRecipients(adminId, requestId),
      ]);
    },
    [isCurrentHistoryRequest, loadHistoryPlayers, loadRecentRecipients],
  );

  useEffect(() => {
    if (!canAccessAdminWallet || !currentAccountId) return;
    const timer = setTimeout(() => void loadHistory(currentAccountId), 0);
    return () => clearTimeout(timer);
  }, [canAccessAdminWallet, currentAccountId, loadHistory]);

  useEffect(() => {
    const term = search.trim();

    if (!canAccessAdminWallet || !currentAccountId || !/^\d{6}$/.test(term)) return;

    let active = true;

    const timer = setTimeout(async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, player_id")
        .neq("id", currentAccountId)
        .eq("player_id", `DV-${term}`)
        .maybeSingle();

      if (!active) return;

      if (error) {
        setMessage(error.message);
        setPlayers([]);
        return;
      }

      setPlayers(data ? [data as Player] : []);
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [canAccessAdminWallet, currentAccountId, search]);

  const send = () => {
    const value = Number(amount);
    const confirmedAccountId = currentAccountId;
    const confirmedAuthGeneration = auth.generation;

    if (
      !canAccessAdminWallet ||
      !confirmedAccountId ||
      !selected ||
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > currentBalance
    ) {
      setMessage(
        "Select a player and enter a whole amount within your balance.",
      );
      return;
    }

    Alert.alert(
      "Confirm transfer",
      `Send ${value.toLocaleString()} ${currencyLabel(
        currency,
      )} to ${selected.username}?`,
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Send",
          onPress: async () => {
            const currentAuth = getAuthState();
            if (
              !hasReadySession(currentAuth) ||
              currentAuth.userId !== confirmedAccountId ||
              currentAuth.generation !== confirmedAuthGeneration ||
              currentAccountIdRef.current !== confirmedAccountId
            ) {
              return;
            }
            const sendRequestId = ++sendRequestRef.current;
            setSending(true);
            setMessage("");

            try {
              const { error } = await supabase.rpc(
                "distribute_wallet_currency",
                {
                  p_receiver_id: selected.id,
                  p_currency: currency,
                  p_amount: value,
                },
              );

              if (error) throw error;

              if (
                sendRequestRef.current !== sendRequestId ||
                getAuthState().userId !== confirmedAccountId
              ) return;

              setAmount("");
              setMessage("Transfer sent.");

              await Promise.all([
                refreshWallet(),
                loadHistory(confirmedAccountId),
              ]);
            } catch (error) {
              if (sendRequestRef.current === sendRequestId) {
                setMessage(
                  error instanceof Error
                    ? error.message
                    : "Transfer failed.",
                );
              }
            } finally {
              if (sendRequestRef.current === sendRequestId) setSending(false);
            }
          },
        },
      ],
    );
  };

  const renderTransfer = (
    item: Transfer,
    direction: "sent" | "received",
  ) => {
    const otherUserId =
      direction === "sent"
        ? item.to_user_id
        : item.from_user_id;

    const otherUser = historyPlayers[otherUserId ?? ""];

    return (
      <View
        key={item.id}
        style={styles.historyRow}
      >
        <View style={styles.historyLeft}>
          <PlayerAvatar
            avatarId={otherUser?.avatar_id as AvatarId | undefined}
            avatarUrl={otherUser?.avatar_url ?? undefined}
            size={32}
            style={styles.historyIcon}
          />

          <View style={styles.historyInfo}>
            <Text
              style={styles.historyName}
              numberOfLines={1}
            >
              {otherUser
                ? `${otherUser.username} - ${otherUser.player_id}`
                : otherUserId ?? "Unknown player"}
            </Text>

            <Text style={styles.historyDate}>
              {new Date(
                item.created_at,
              ).toLocaleString()}
            </Text>
          </View>
        </View>

        <View style={styles.historyAmountBox}>
          <Text
            style={[
              styles.historyAmount,
              direction === "received" &&
                styles.receivedAmount,
            ]}
          >
            {direction === "sent" ? "−" : "+"}
            {Number(item.amount).toLocaleString()}
          </Text>

          <Text style={styles.historyCurrency}>
            {currencyLabel(item.currency)}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <View
        style={[
          styles.content,
          {
            paddingHorizontal: horizontalInset,
          },
        ]}
      >
        <View style={styles.topBar}>
          <View style={styles.headerRight}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              onPress={() => router.back()}
              style={({ pressed }) => [
                styles.backButton,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons
                name="chevron-forward"
                size={23}
                color="#ffffff"
              />
            </Pressable>

            <View style={styles.headerText}>
              <Text style={styles.title}>
                Return to Game
              </Text>
            </View>
          </View>

          <View style={styles.balanceStrip}>
            {[...currencies].reverse().map((item) => (
              <View
                key={item.value}
                style={styles.balanceBox}
              >
                <View style={styles.balanceTop}>
                  <Text style={styles.balanceCurrencyIcon}>
                    {item.value === "Gem"
                      ? "\u{1F48E}"
                      : item.value === "Coin"
                        ? "\u{1FA99}"
                        : "\u2728"}
                  </Text>

                  <Text style={styles.balanceLabel}>
                    {item.label}
                  </Text>
                </View>

                <Text
                  style={styles.balanceValue}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {currentWallet
                    ? balances[item.value].toLocaleString()
                    : "—"}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color="#f8d774" />
          </View>
        ) : !canAccessAdminWallet ? (
          <View style={styles.centerState}>
            <Text style={styles.emptyText}>
              Access denied.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.tabBar}>
              <Pressable
                onPress={() => {
                  setTab("sent");
                  setMessage("");
                }}
                style={[
                  styles.tabButton,
                  tab === "sent" &&
                    styles.tabButtonActive,
                ]}
              >
                <Ionicons
                  name="arrow-up-outline"
                  size={16}
                  color={
                    tab === "sent"
                      ? "#201324"
                      : "#aba0b7"
                  }
                />

                <Text
                  style={[
                    styles.tabText,
                    tab === "sent" &&
                      styles.tabTextActive,
                  ]}
                >
                  Sent
                </Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setTab("received");
                  setMessage("");
                }}
                style={[
                  styles.tabButton,
                  tab === "received" &&
                    styles.tabButtonActive,
                ]}
              >
                <Ionicons
                  name="arrow-down-outline"
                  size={16}
                  color={
                    tab === "received"
                      ? "#201324"
                      : "#aba0b7"
                  }
                />

                <Text
                  style={[
                    styles.tabText,
                    tab === "received" &&
                      styles.tabTextActive,
                  ]}
                >
                  Received
                </Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setTab("send");
                  setMessage("");
                }}
                style={[
                  styles.tabButton,
                  tab === "send" &&
                    styles.tabButtonActive,
                ]}
              >
                <Ionicons
                  name="paper-plane-outline"
                  size={16}
                  color={
                    tab === "send"
                      ? "#201324"
                      : "#aba0b7"
                  }
                />

                <Text
                  style={[
                    styles.tabText,
                    tab === "send" &&
                      styles.tabTextActive,
                  ]}
                >
                  Send
                </Text>
              </Pressable>
            </View>

            {tab === "send" && (
              <BlurView
                intensity={45}
                tint="dark"
                style={styles.mainPanel}
              >
                <View style={styles.sendColumns}>
                  <View style={styles.column}>
                    <View style={styles.searchBox}>
                      <Ionicons
                        name="search-outline"
                        size={17}
                        color="#82788d"
                      />

                      <TextInput
                        style={[styles.searchInput, { textAlign: "left" }]}
                        value={search}
                        onChangeText={(text) => {
                          setSearch(text.replace(/^DV-/i, "").replace(/\D/g, ""));
                          setPlayers([]);
                          setSelected(null);
                        }}
                        placeholder="123456"
                        placeholderTextColor="#82788d"
                        autoCapitalize="none"
                        keyboardType="number-pad"
                      />
                      <Text style={{ color: "#82788d", fontSize: 13 }}>
                        DV-
                      </Text>
                    </View>

                    {players.length > 0 && (
                      <View
                        style={styles.searchResults}
                      >
                        {players.map((player) => (
                          <Pressable
                            key={player.id}
                            style={styles.playerResult}
                            onPress={() => {
                              setSelected(player);
                              setSearch("");
                              setPlayers([]);
                            }}
                          >
                            <View
                              style={styles.playerIcon}
                            >
                              <Ionicons
                                name="person-outline"
                                size={16}
                                color="#e9d5ff"
                              />
                            </View>

                            <View
                              style={styles.playerDetails}
                            >
                              <Text
                                style={styles.playerName}
                              >
                                {player.username}
                              </Text>

                              <Text
                                style={styles.playerId}
                              >
                                {player.player_id}
                              </Text>
                            </View>

                            <Ionicons
                              name="chevron-forward"
                              size={17}
                              color="#706777"
                            />
                          </Pressable>
                        ))}
                      </View>
                    )}

                    {selected ? (
                      <View
                        style={styles.selectedPlayer}
                      >
                        <View
                          style={
                            styles.selectedPlayerIcon
                          }
                        >
                          <Ionicons
                            name="person"
                            size={16}
                            color="#f8d774"
                          />
                        </View>

                        <View
                          style={styles.playerDetails}
                        >
                          <Text
                            style={styles.selectedName}
                          >
                            {selected.username}
                          </Text>

                          <Text style={styles.playerId}>
                            {selected.player_id}
                          </Text>
                        </View>

                        <Pressable
                          onPress={() =>
                            setSelected(null)
                          }
                        >
                          <Ionicons
                            name="close"
                            size={18}
                            color="#8e8595"
                          />
                        </Pressable>
                      </View>
                    ) : (
                      <View
                        style={
                          styles.playerPlaceholder
                        }
                      >
                        <Ionicons
                          name="person-add-outline"
                          size={20}
                          color="#61586a"
                        />

                        <Text
                          style={styles.placeholderText}
                        >
                          Select a player
                        </Text>
                      </View>
                    )}
                    <View style={styles.recentRecipients}>
                      {recentRecipients.map(({ player, amount: lastAmount, currency: lastCurrency }) => (
                        <Pressable
                          key={player.id}
                          accessibilityRole="button"
                          accessibilityLabel={`Select ${player.username}`}
                          onPress={() => {
                            setSelected({ id: player.id, username: player.username, player_id: player.player_id });
                            setSearch("");
                            setPlayers([]);
                          }}
                          style={styles.recentRecipient}
                        >
                          <PlayerAvatar
                            avatarId={player.avatar_id as AvatarId}
                            avatarUrl={player.avatar_url ?? undefined}
                            size={32}
                          />
                          <View style={styles.recentRecipientInfo}>
                            <Text style={styles.playerName} numberOfLines={1}>{player.username}</Text>
                            <Text style={styles.playerId} numberOfLines={1}>{player.player_id}</Text>
                          </View>
                          <Text style={styles.recentRecipientAmount} numberOfLines={1}>
                            {lastAmount.toLocaleString()} {currencyLabel(lastCurrency)}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>

                  <View style={styles.columnDivider} />

                  <View style={styles.column}>
                    <View style={styles.currencyRow}>
                      {currencies.map((item) => (
                        <Pressable
                          key={item.value}
                          onPress={() => {
                            setCurrency(item.value);
                            setAmount("");
                          }}
                          style={[
                            styles.currencyButton,
                            currency ===
                              item.value &&
                              styles.currencyButtonActive,
                          ]}
                        >
                          <Text style={styles.currencyEmoji}>
                            {item.value === "Gem"
                              ? "\u{1F48E}"
                              : item.value === "Coin"
                                ? "\u{1FA99}"
                                : "\u2728"}
                          </Text>

                          <Text
                            style={[
                              styles.currencyText,
                              currency ===
                                item.value &&
                                styles.currencyTextActive,
                            ]}
                          >
                            {item.label.toUpperCase()}
                          </Text>
                        </Pressable>
                      ))}
                    </View>

                    <View style={styles.amountBox}>
                      <Text
                        style={styles.amountCurrency}
                      >
                        {`${currencyLabel(currency).toUpperCase()}:  `}
                      </Text>

                      <TextInput
                        style={styles.amountInput}
                        value={amount}
                        onChangeText={setAmount}
                        placeholder="0"
                        placeholderTextColor="#5f5767"
                        keyboardType="number-pad"
                      />
                    </View>

                    <View style={styles.quickAmountGrid}>
                      {quickAmounts[currency].map(
                        (value) => {
                          const disabled =
                            value > currentBalance;

                          const activeAmount =
                            Number(amount) === value;

                          return (
                            <Pressable
                              key={value}
                              disabled={disabled}
                              onPress={() =>
                                setAmount(String(value))
                              }
                              style={[
                                styles.quickAmountButton,
                                activeAmount &&
                                  styles.quickAmountButtonActive,
                                disabled &&
                                  styles.quickAmountButtonDisabled,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.quickAmountText,
                                  activeAmount &&
                                    styles.quickAmountTextActive,
                                ]}
                              >
                                {value.toLocaleString()}
                              </Text>
                            </Pressable>
                          );
                        },
                      )}
                    </View>

                    <Pressable
                      accessibilityRole="button"
                      disabled={sending}
                      onPress={send}
                      style={({ pressed }) => [
                        styles.sendButton,
                        sending &&
                          styles.sendButtonDisabled,
                        pressed &&
                          !sending &&
                          styles.pressed,
                      ]}
                    >
                      <Text
                        style={styles.sendButtonText}
                      >
                        {sending
                          ? "Sending..."
                          : "Send funds"}
                      </Text>

                      <Ionicons
                        name="paper-plane"
                        size={16}
                        color="#271607"
                      />
                    </Pressable>
                  </View>
                </View>

                {!!message && (
                  <Text style={styles.message}>
                    {message}
                  </Text>
                )}
              </BlurView>
            )}

            {tab === "received" && (
              <BlurView
                intensity={45}
                tint="dark"
                style={[styles.mainPanel, styles.historyPanel]}
              >
                <ScrollView style={styles.historyScroll} showsVerticalScrollIndicator={false}>
                  {visibleReceivedHistory.length === 0 ? (
                    <View style={styles.historyEmpty}>
                      <Ionicons
                        name="file-tray-outline"
                        size={27}
                        color="#5f5668"
                      />

                      <Text style={styles.emptyText}>
                        No received transfers yet
                      </Text>
                    </View>
                  ) : (
                    visibleReceivedHistory.map((item) =>
                      renderTransfer(
                        item,
                        "received",
                      ),
                    )
                  )}
                </ScrollView>
              </BlurView>
            )}

            {tab === "sent" && (
              <BlurView
                intensity={45}
                tint="dark"
                style={[styles.mainPanel, styles.historyPanel]}
              >
                <ScrollView style={styles.historyScroll} showsVerticalScrollIndicator={false}>
                  {visibleSentHistory.length === 0 ? (
                    <View style={styles.historyEmpty}>
                      <Ionicons
                        name="file-tray-outline"
                        size={27}
                        color="#5f5668"
                      />

                      <Text style={styles.emptyText}>
                        No sent transfers yet
                      </Text>
                    </View>
                  ) : (
                    visibleSentHistory.map((item) =>
                      renderTransfer(item, "sent"),
                    )
                  )}
                </ScrollView>
              </BlurView>
            )}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#080817",
  },

  content: {
    flex: 1,
    width: "100%",
    alignSelf: "stretch",
    paddingTop: 10,
    paddingBottom: 12,
  },

  topBar: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    gap: 20,
  },

  balanceStrip: {
    direction: "ltr",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },

  balanceBox: {
    direction: "ltr",
    width: 132,
    height: 58,
    paddingHorizontal: 12,
    justifyContent: "center",
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.035)",
  },

  balanceTop: {
    direction: "ltr",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 4,
  },

  balanceCurrencyIcon: {
    fontSize: 13,
  },

  balanceLabel: {
    writingDirection: "ltr",
    textAlign: "left",
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "500",
  },

  balanceValue: {
    writingDirection: "ltr",
    textAlign: "left",
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },

  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginLeft: "auto",
  },

  headerText: {
    alignItems: "flex-end",
  },

  title: {
    color: "#ffffff",
    fontSize: 19,
    fontWeight: "700",
  },

  backButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.045)",
  },

  tabBar: {
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    padding: 4,
    marginBottom: 10,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    backgroundColor: "rgba(255,255,255,0.035)",
  },

  tabButton: {
    flex: 1,
    height: 34,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },

  tabButtonActive: {
    backgroundColor: "#f8d774",
  },

  tabText: {
    color: "#aba0b7",
    fontSize: 12,
    fontWeight: "600",
  },

  tabTextActive: {
    color: "#201324",
  },

  mainPanel: {
    overflow: "hidden",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(0,0,0,0.12)",
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: {
      width: 0,
      height: 8,
    },
    elevation: 20,
  },

  historyPanel: {
    flex: 1,
    minHeight: 0,
  },

  historyScroll: {
    flex: 1,
  },

  sendColumns: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 16,
  },

  column: {
    flex: 1,
    minWidth: 0,
  },

  recentRecipients: {
    gap: 5,
    marginBottom: 12,
  },

  recentRecipient: {
    direction: "ltr",
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.035)",
  },

  recentRecipientInfo: {
    flex: 1,
    minWidth: 0,
    alignItems: "flex-start",
  },

  recentRecipientAmount: {
    marginLeft: "auto",
    writingDirection: "ltr",
    textAlign: "right",
    color: "#f8d774",
    fontSize: 11,
    fontWeight: "600",
  },

  columnDivider: {
    width: 1,
    backgroundColor: "rgba(255,255,255,0.07)",
  },

  searchBox: {
    height: 43,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 11,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    backgroundColor: "rgba(255,255,255,0.045)",
  },

  searchInput: {
    flex: 1,
    height: "100%",
    color: "#ffffff",
    fontSize: 13,
    padding: 0,
  },

  searchResults: {
    marginTop: 7,
    overflow: "hidden",
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(7,6,18,0.94)",
  },

  playerResult: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.055)",
  },

  playerIcon: {
    width: 31,
    height: 31,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(139,92,246,0.11)",
    marginRight: 9,
  },

  playerDetails: {
    flex: 1,
    minWidth: 0,
  },

  playerName: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },

  playerId: {
    color: "#82788d",
    fontSize: 12,
    marginTop: 2,
  },

  selectedPlayer: {
    height: 52,
    marginTop: 9,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "rgba(248,215,116,0.20)",
    backgroundColor: "rgba(248,215,116,0.055)",
  },

  selectedPlayerIcon: {
    width: 31,
    height: 31,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 9,
    backgroundColor: "rgba(248,215,116,0.10)",
  },

  selectedName: {
    color: "#f8d774",
    fontSize: 12,
    fontWeight: "600",
  },

  playerPlaceholder: {
    height: 52,
    marginTop: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 9,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(255,255,255,0.09)",
  },

  placeholderText: {
    color: "#685f71",
    fontSize: 11,
  },

  currencyRow: {
    flexDirection: "row",
    gap: 7,
    marginBottom: 14,
  },

  currencyButton: {
    direction: "ltr",
    flex: 1,
    height: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    backgroundColor: "rgba(255,255,255,0.035)",
  },

  currencyButtonActive: {
    borderColor: "rgba(248,215,116,0.50)",
    backgroundColor: "rgba(248,215,116,0.09)",
  },

  currencyEmoji: {
    fontSize: 12,
  },

  currencyText: {
    writingDirection: "ltr",
    color: "#8f849b",
    fontSize: 11,
    fontWeight: "600",
  },

  currencyTextActive: {
    color: "#f8d774",
  },

  amountBox: {
    direction: "ltr",
    height: 43,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 11,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    backgroundColor: "rgba(255,255,255,0.045)",
    marginBottom: 8,
  },

  amountInput: {
    flex: 1,
    height: "100%",
    writingDirection: "ltr",
    textAlign: "left",
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
    padding: 0,
  },

  amountCurrency: {
    writingDirection: "ltr",
    textAlign: "left",
    color: "#81788d",
    fontSize: 12,
    fontWeight: "600",
  },

  quickAmountGrid: {
    direction: "ltr",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 10,
  },

  quickAmountButton: {
    width: "18.6%",
    height: 29,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 7,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.035)",
  },

  quickAmountButtonActive: {
    borderColor: "rgba(248,215,116,0.55)",
    backgroundColor: "rgba(248,215,116,0.11)",
  },

  quickAmountButtonDisabled: {
    opacity: 0.25,
  },

  quickAmountText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },

  quickAmountTextActive: {
    color: "#f8d774",
  },

  sendButton: {
    height: 43,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 9,
    backgroundColor: "#f8d774",
  },

  sendButtonDisabled: {
    opacity: 0.5,
  },

  sendButtonText: {
    color: "#271607",
    fontSize: 13,
    fontWeight: "700",
  },

  message: {
    marginTop: 10,
    color: "#f8d774",
    fontSize: 11,
    textAlign: "center",
  },

  historyRow: {
    direction: "ltr",
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },

  historyLeft: {
    direction: "ltr",
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
  },

  historyIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 9,
    backgroundColor: "rgba(255,255,255,0.045)",
  },

  historyInfo: {
    flex: 1,
    minWidth: 0,
  },

  historyName: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },

  historyDate: {
    color: "#776e80",
    fontSize: 9,
    marginTop: 2,
  },

  historyAmountBox: {
    alignItems: "flex-end",
    marginLeft: 12,
  },

  historyAmount: {
    color: "#f8d774",
    fontSize: 13,
    fontWeight: "700",
  },

  receivedAmount: {
    color: "#d8b4fe",
  },

  historyCurrency: {
    color: "#776e80",
    fontSize: 9,
    marginTop: 2,
  },

  historyEmpty: {
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },

  emptyText: {
    color: "#81788d",
    fontSize: 11,
  },

  centerState: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
  },

  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.985 }],
  },
});
