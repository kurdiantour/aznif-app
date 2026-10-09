import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

const sections = [
  {
    title: "زانیارییەکانی کە کۆدەکرێنەوە",
  body: [
    "• کاتێک هەژمار دروست دەکەیت یان دەچیتە ژوورەوە، ئەزنیف دەتوانێت ناوی بەکارهێنەر، ئیمەیڵ، ناسنامەی یاریزان، ئاست، خاڵ، زانیاریی بنەڕەتی ئامێر و وەشانی ئەپ هەڵبگرێت.",
    "• هەروەها ئامار و ئەنجامی یاری، مێژووی یاری، بردنەوە، دۆڕان، خاڵ و هەندێک زانیاریی پەیوەندیدار بە یاری هەڵدەگیرێن بۆ باشترکردنی ئەزموونی یاری و کارکردنی ئەپ.",
    "• ئێمە وشەی نهێنی بە شێوەی ڕاستەوخۆ هەڵناگرین و دەپارێزرێت بە شێوازێکی پارێزراو.",
  ],
  },
  {
    title: "ڕیزبەندی گشتی",
  body: [
    "• ئەزنیف ڕیزبەندی گشتی هەیە بۆ ئەوەی یاریزانان بتوانن پلە و ئەنجامی یەکتری ببینن و پێشبڕکێیەکی خۆشتر ئەزموون بکەن.",
    "• ئەگەر بەشداری لە ڕیزبەندی گشتی بکەیت، ناوی بەکارهێنەر، پلە، خاڵ، باڵانسی ئەزنیف و باڵانسی گەوهەر  لە ڕیزبەندی گشتی نیشان بدرێن.",
    "• ئەم زانیارییانە تەنها بۆ کارکردنی ڕیزبەندی، پێشبڕکێ و باشترکردنی ئەزموونی یاری بەکاردێن.",
  ],
  },
  {
title: "ئەزنیف و گەوهەر",
body: [
  "• ئەزنیف و گەوهەر دراوی مەجازی ناو یارین کە لە ڕێگەی یاری کردن، بردنەوە، پاداشت و چالاکییەکانی ناو ئەپ بەدەست دێن.",
  "• لە وەشانی ئێستای ئەپدا، ئەزنیف و گەوهەر بە پارەی ڕاستەقینە ناکڕدرێن.",
  "• ئەزنیف و گەوهەر تەنها لە ناو ئەپ بەکاردێن و ناتوانرێن بگۆڕدرێن بۆ پارە، کارتی دیاری، کاڵای فیزیکی یان هیچ شتێکی دەرەوەی یاری. ئەمانە هیچ بەهایەکی نەقدیان نییە.",
],
  },
  {
    title: "هاوڕێکان و گواستنەوە",
body: [ "• ئەگەر بەشی هاوڕێکان بەکاربهێنیت، لیستی هاوڕێکان، داواکارییەکان، بانگهێشتی یاری و دۆخی ئامادەبوونیان بۆ کارکردنی ئەم بەشە لەسەر سێرڤەر هەڵدەگیرێن.", "• گواستنەوەی ئەزنیف تەنها لە نێوان هاوڕێی پەسەندکراو ئەنجام دەدرێت. بۆ پاراستنی باڵانس و ڕێگریکردن لە فێڵ، زانیارییەکانی وەک نێرەر، وەرگر، بڕی گواستنەوە، کات و دۆخی مامەڵە هەڵدەگیرێن.", ],
  },
  {
    title: "مێژووی یاری و یاریی دادپەروەرانە",
    body: [
      "• ئەنجامی یاری، خاڵ، بردنەوە، دۆڕان، پاداشت و کردارەکانی یاری هەڵدەگیرێن بۆ نیشاندانی پرۆفایل، ڕیزبەندی گشتی، هاوتاکردنی یاریزانان و پاداشتدان.",
      "• هەندێک زانیاری بۆ ڕێگریکردن لە فێڵ، بەکارهێنانی خراپ و پاراستنی یاریی دادپەروەرانە بەکاردێت.",
    ],
  },
];

const rtl = (text: string) => `\u202B${text}\u202C`;

export default function PrivacyScreen() {
  const router = useRouter();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator
    >
      <View style={styles.page}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={rtl("گەڕانەوە")}
          hitSlop={10}
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Text style={styles.backText}>{rtl("گەڕانەوە")}</Text>
          <Ionicons name="chevron-forward" size={18} color="#ffffff" />
        </Pressable>

        <View style={styles.header}>
          <Text style={styles.title}>
            {rtl("سیاسەتی پاراستنی نهێنی ئەزنیف")}
          </Text>
          <Text style={styles.date}>
            {rtl("ڕێکەوتی کاریگەر: ٩ی تەممووزی ٢٠٢٦")}
          </Text>
        </View>

        <Text style={styles.intro}>
          {rtl(
            "ئەم سیاسەتە ڕوون دەکاتەوە کە ئەزنیف چ جۆرە زانیارییەک کۆدەکاتەوە، بۆچی کۆی دەکاتەوە، چۆن بەکاری دەهێنێت، لە کوێ هەڵیدەگرێت و چۆن دەپارێزرێت. بە بەکارهێنانی ئەم ئەپە، بەکارهێنەر ئەم سیاسەتە دەخوێنێتەوە و پەسەندی دەکات.",
          )}
        </Text>

        {sections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{rtl(section.title)}</Text>
            {section.body.map((paragraph) => (
              <Text key={paragraph} style={styles.paragraph}>
                {rtl(paragraph)}
              </Text>
            ))}
          </View>
        ))}

        <View style={styles.section}>
          <Text style={styles.paragraph}>
            {rtl(
              "ئەم سیاسەتە دەتوانێت لە داهاتوودا بەپێی پێویست نوێ بگۆڕدرێت."
            )}
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const rtlText = {
  width: "100%" as const,
  textAlign: "left" as const,
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#050b22",
  },
  content: {
    flexGrow: 1,
    width: "100%",
    alignItems: "stretch",
    paddingHorizontal: 50,
    paddingVertical: 30,
  },
  page: {
    width: "100%",
    maxWidth: 920,
    alignSelf: "flex-end",
    marginLeft: "auto",
    direction: "rtl",
  },
  backButton: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(15,23,42,0.68)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
    marginBottom: 18,
    direction: "rtl",
  },
  backText: {
    color: "#ffffff",
    fontSize: 12,
    fontFamily: "SpedaBold",
    direction: "rtl",
    textAlign: "right",
    writingDirection: "rtl",
  },
  header: {
    width: "100%",
    alignItems: "flex-end",
    marginBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.12)",
    paddingBottom: 16,
  },
  title: {
    ...rtlText,
    color: "#ffffff",
    fontSize: 16,
    fontFamily: "SpedaBold",
    lineHeight: 38,
  },
  date: {
    ...rtlText,
    marginTop: 8,
    color: "#a8b7d5",
    fontSize: 14,
    fontFamily: "SpedaBold",
  },
  intro: {
    ...rtlText,
    color: "#dbeafe",
    fontSize: 16,
    fontFamily: "SpedaRegular",
    lineHeight: 27,
    marginBottom: 8,
  },
  section: {
    width: "100%",
    alignItems: "stretch",
    marginTop: 20,
  },
  sectionTitle: {
    ...rtlText,
    color: "#7dd3fc",
    fontSize: 16,
    fontFamily: "SpedaBold",
    lineHeight: 30,
    marginBottom: 8,
  },
  paragraph: {
    ...rtlText,
    color: "#e5edf8",
    fontSize: 14,
    fontFamily: "SpedaRegular",
    lineHeight: 27,
    marginBottom: 8,
  },
});
