import { Text, Linking,
  Pressable,
  ScrollView,
  StyleSheet,
useWindowDimensions,
  View,
} from 'react-native';

const EFFECTIVE_DATE = 'June 15, 2026';
const PRIVACY_EMAIL = 'privacy@aznif.com';

type PolicySectionProps = {
  title: string;
  children: React.ReactNode;
};

export default function PrivacyPolicyScreen() {
  const { width, height } = useWindowDimensions();
  const isTablet = Math.min(width, height) >= 600;

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={[
        styles.scrollContent,
        isTablet ? styles.scrollContentTablet : styles.scrollContentMobile,
      ]}
      showsVerticalScrollIndicator
    >
        <View style={[styles.document, isTablet && styles.documentTablet]}>
          <Text style={styles.title}>سیاسەتی تایبەتمەندی</Text>
          <Text style={styles.effectiveDate}>بەرواری کارپێکردن و نوێکردنەوە: {EFFECTIVE_DATE}</Text>

          <Text style={styles.intro}>
            This Privacy Policy explains how Aznif (&quot;Aznif,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) collects,
            uses, shares, and protects information when you use the Aznif mobile application and
            related game services (collectively, the &quot;Service&quot;). By using the
            Service, you acknowledge the practices described in this Policy.
          </Text>

          <PolicySection title="1. Information We Collect">
            <BodyText>
              <Bold>Account information.</Bold> When you create an account, we collect your email
              address, authentication identifiers, and account creation and verification details.
              Passwords are handled by Supabase Authentication and are not visible to Aznif in
              readable form.
            </BodyText>
            <BodyText>
              <Bold>Player profile information.</Bold> We collect your chosen username, player ID,
              avatar selection, experience level, points, and rank. Your
              username, player ID, avatar, rank, level, and leaderboard results may be visible to
              other players.
            </BodyText>
            <BodyText>
              <Bold>Game and matchmaking information.</Bold> We process matchmaking queue status,
              game room membership, opponents and teammates, game actions and moves, scores,
              outcomes, forfeits, rewards, timestamps, and connection state needed to operate
              matches, enforce game rules, resolve technical issues, and maintain leaderboards.
            </BodyText>
            <BodyText>
              <Bold>Social and transaction information.</Bold> If you use social or economy
              features, we process friend requests and relationships, virtual currency balances,
              virtual item purchases, transfers between players, and transaction history. Virtual
              currency, points, rewards, and in-game balances are entertainment features only. They
              have no real-world cash value, are not redeemable for cash, and do not represent a
              bank account, stored-value account, financial product, or cryptocurrency.
            </BodyText>
            <BodyText>
              <Bold>Technical information.</Bold> Our hosting and authentication provider may
              automatically receive information such as IP address, device or browser type,
              operating system, app version, request timestamps, and security logs when you access
              the Service.
            </BodyText>
            <BodyText>
              We do not request precise location, contacts, photos, microphone access, health data,
              or advertising identifiers as part of the current Service.
            </BodyText>
          </PolicySection>

          <PolicySection title="2. How We Use Information">
            <Bullet>create, authenticate, secure, and support your account;</Bullet>
            <Bullet>provide player profiles, matchmaking, multiplayer games, friends, leaderboards, rewards, and statistics;</Bullet>
            <Bullet>save game state, settle results, maintain fair play, and detect fraud, abuse, or security incidents;</Bullet>
            <Bullet>respond to privacy or support requests and send authentication or account notices;</Bullet>
            <Bullet>debug, maintain, secure, and improve the Service; and</Bullet>
            <Bullet>comply with law, enforce our terms, and protect players, Aznif, and others.</Bullet>
          </PolicySection>

          <PolicySection title="3. Legal Bases">
            <BodyText>
              Where applicable law requires a legal basis, we process information as necessary to
              perform our contract with you by providing the Service; for our legitimate interests
              in securing, operating, and improving the Service; with your consent where requested;
              and to comply with legal obligations. You may withdraw consent at any time, without
              affecting processing that occurred before withdrawal.
            </BodyText>
          </PolicySection>

          <PolicySection title="4. How We Share Information">
            <BodyText>
              <Bold>Other players.</Bold> Profile fields and leaderboard standing are visible to
              authenticated players. Match participants can see information needed for the game,
              including usernames, avatars, actions, scores, and results. We do not display your
              email address to other players.
            </BodyText>
            <BodyText>
              <Bold>Service providers.</Bold> We use Supabase to provide authentication, database,
              realtime multiplayer, server functions, hosting, and related infrastructure.
              Supabase processes information to provide those services. Apple separately processes
              information when you download or use the app through its platform, subject to
              Apple&apos;s privacy practices.
            </BodyText>
            <BodyText>
              <Bold>Legal and safety disclosures.</Bold> We may disclose information when reasonably
              necessary to comply with law or legal process, investigate abuse or fraud, enforce
              agreements, or protect the rights, safety, and security of Aznif, our players, or the
              public.
            </BodyText>
            <BodyText>
              <Bold>Business transfers.</Bold> Information may be transferred as part of a merger,
              financing, acquisition, reorganization, bankruptcy, or sale of assets, subject to
              appropriate confidentiality protections.
            </BodyText>
            <BodyText>
              We do not sell your personal information, share it for cross-context behavioral
              advertising, or use it to track you across apps and websites owned by other companies.
            </BodyText>
          </PolicySection>

          <PolicySection title="5. Data Retention">
            <BodyText>
              We retain account and profile information while your account is active. Match,
              leaderboard, security, and transaction records may be retained for as long as needed
              to operate the Service, preserve game integrity, resolve disputes, and meet legal
              obligations. Retention periods vary by record type. Account deletion removes or
              disconnects personal identifiers as described below. Service-provider backups may
              persist temporarily according to the provider&apos;s backup schedule.
            </BodyText>
          </PolicySection>

          <PolicySection title="6. Your Choices and Rights">
            <BodyText>
              You may review and update certain profile information in the app. Depending on where
              you live, you may have rights to access, correct, delete, restrict, object to, or
              receive a portable copy of your personal information, and to appeal a denied request.
              You may also lodge a complaint with your local data protection authority.
            </BodyText>
            <BodyText>
              To permanently delete your account, open <Bold>Settings &gt; Delete Account</Bold>, type
              DELETE, and confirm. You must first leave or cancel any active match. This deletes your
              authentication account and associated profile, in-game balances, item ownership, and
              friend relationships. Some historical game and transaction records may remain with
              your account identifier removed or disconnected so that Aznif can preserve completed
              match and ledger integrity. You may also contact us using the address below. We may
              verify your identity before completing a privacy request.
            </BodyText>
          </PolicySection>

          <PolicySection title="7. Security and International Transfers">
            <BodyText>
              We use reasonable administrative and technical safeguards, including authenticated
              access controls and encrypted network connections. No system is fully secure, and we
              cannot guarantee absolute security. Supabase may process information in a country
              other than your own, subject to its applicable data-transfer safeguards.
            </BodyText>
          </PolicySection>

          <PolicySection title="8. Children's Privacy">
            <BodyText>
              Aznif is not directed to children under 13, or the higher minimum age required to
              consent to data processing in their country. We do not knowingly collect personal
              information from children below that age. If you believe a child has provided us with
              personal information without valid parental consent, contact us and we will take
              appropriate steps to delete it.
            </BodyText>
          </PolicySection>

          <PolicySection title="9. Third-Party Services and Links">
            <BodyText>
              The Service relies on Supabase and the platform through which you obtain the app.
              Their handling of information for their own purposes is governed by their privacy
              policies. This Policy does not cover services we do not control.
            </BodyText>
          </PolicySection>

          <PolicySection title="10. Changes to This Policy">
            <BodyText>
              We may update this Policy as the Service or law changes. We will post the revised
              Policy with a new effective date and provide additional notice when required. Your
              continued use of the Service after an update is subject to the revised Policy.
            </BodyText>
          </PolicySection>

          <PolicySection title="11. Contact Us">
            <BodyText>
              For privacy questions or requests, contact Aznif at:
            </BodyText>
            <Pressable
              accessibilityRole="link"
              onPress={() => void Linking.openURL(`mailto:${PRIVACY_EMAIL}`)}
            >
              <Text style={styles.email}>{PRIVACY_EMAIL}</Text>
            </Pressable>
          </PolicySection>
        </View>
    </ScrollView>
  );
}

function PolicySection({ title, children }: PolicySectionProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function BodyText({ children }: { children: React.ReactNode }) {
  return <Text style={styles.body}>{children}</Text>;
}

function Bold({ children }: { children: React.ReactNode }) {
  return <Text style={styles.bold}>{children}</Text>;
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.bulletRow}>
      <Text style={styles.bulletMark}>{'\u2022'}</Text>
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollView: { flex: 1 },
  scrollContent: {
    alignItems: 'center',
    paddingBottom: 88,
  },
  scrollContentMobile: {
    paddingHorizontal: 4,
    paddingTop: 10,
  },
  scrollContentTablet: {
    paddingHorizontal: 32,
    paddingTop: 24,
    paddingBottom: 104,
  },
  document: {
    width: '100%',
    maxWidth: 760,
    paddingHorizontal: 12,
    paddingBottom: 28,
  },
  documentTablet: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  title: { color: '#fff', fontSize: 19, fontFamily: 'Speda-Bold', textAlign: 'center' },
  effectiveDate: { marginTop: 6, color: '#a99bd8', fontSize: 12, fontFamily: 'Speda-Regular', textAlign: 'center' },
  intro: { marginTop: 22, color: '#e5e7eb', fontSize: 14, lineHeight: 23 },
  section: { marginTop: 24 },
  sectionTitle: { color: '#c4b5fd', fontSize: 17, fontFamily: 'Speda-Bold', marginBottom: 8 },
  body: { color: '#d7d9e0', fontSize: 14, lineHeight: 23, marginBottom: 10 },
  bold: { color: '#fff', fontFamily: 'Speda-Bold' },
  bulletRow: { flexDirection: 'row', paddingRight: 8, marginBottom: 7 },
  bulletMark: { width: 20, color: '#a78bfa', fontSize: 16, lineHeight: 22 },
  bulletText: { flex: 1, color: '#d7d9e0', fontSize: 14, lineHeight: 23 },
  email: { color: '#9fc2ff', fontSize: 14, fontFamily: 'Speda-Bold', textDecorationLine: 'underline' },
});
