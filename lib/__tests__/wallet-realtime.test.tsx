import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { Session } from "@supabase/supabase-js";
import type { ReactNode } from "react";
import { publishAuthState } from "@/lib/auth-state";
import { WalletProvider, useWallet } from "@/lib/wallet-context";

const mockGetBalance = jest.fn();
const mockRemoveChannel = jest.fn();
const mockChannels: Array<{ callback: () => void; userId: string }> = [];

jest.mock("@/lib/wallet", () => ({ getBalance: (userId: string) => mockGetBalance(userId) }));
jest.mock("@/lib/supabase", () => ({
  supabase: {
    channel: (name: string) => {
      const channel = { callback: () => {}, userId: name.slice("wallet:".length) };
      mockChannels.push(channel);
      return {
        on: (_event: string, options: { filter: string }, callback: () => void) => {
          expect(options.filter).toBe(`user_id=eq.${channel.userId}`);
          channel.callback = callback;
          return { subscribe: () => channel };
        },
      };
    },
    removeChannel: (channel: unknown) => mockRemoveChannel(channel),
  },
}));

const session = (id: string) => ({ access_token: id, user: { id } }) as Session;
const row = (id: string, mc: number) => ({
  id: `wallet-${id}`,
  user_id: id,
  balances: { mc, coin: 0, gem: 0 },
  updated_at: "",
});
const wrapper = ({ children }: { children: ReactNode }) =>
  <WalletProvider>{children}</WalletProvider>;

beforeEach(() => {
  jest.clearAllMocks();
  mockChannels.length = 0;
  publishAuthState(null, false, true);
  mockGetBalance.mockImplementation(async (id: string) => row(id, 10));
});

afterEach(() => publishAuthState(null, false, false));

test("refreshes MC on the current wallet event without duplicate subscriptions", async () => {
  publishAuthState(session("alice"), true, true);
  const ui = renderHook(useWallet, { wrapper });
  await waitFor(() => expect(ui.result.current.aznifBalance).toBe(10));
  expect(mockChannels).toHaveLength(1);

  mockGetBalance.mockResolvedValueOnce(row("alice", 25));
  await act(async () => mockChannels[0].callback());
  await waitFor(() => expect(ui.result.current.aznifBalance).toBe(25));
  expect(mockChannels).toHaveLength(1);
  ui.unmount();
  expect(mockRemoveChannel).toHaveBeenCalledWith(mockChannels[0]);
});

test("removes the old subscription and rejects its late response after account switch", async () => {
  let resolveOld!: (value: ReturnType<typeof row>) => void;
  mockGetBalance.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  publishAuthState(session("alice"), true, true);
  const ui = renderHook(useWallet, { wrapper });
  await waitFor(() => expect(mockChannels).toHaveLength(1));

  await act(async () => publishAuthState(session("bob"), true, true));
  await waitFor(() => expect(ui.result.current.wallet?.user_id).toBe("bob"));
  expect(mockRemoveChannel).toHaveBeenCalledWith(mockChannels[0]);
  expect(mockChannels).toHaveLength(2);

  await act(async () => { mockChannels[0].callback(); resolveOld(row("alice", 999)); });
  expect(ui.result.current.wallet?.user_id).toBe("bob");
  expect(ui.result.current.aznifBalance).toBe(10);
  ui.unmount();
});
