import {
  StyleSheet,
  Text,
  View,
} from "react-native";


type Props = {
  visible: boolean;
};


export default function ConnectionOverlay({
  visible,
}: Props) {

  if (!visible) return null;


  return (
    <View style={styles.overlay}>

      <View style={styles.content}>

        <Text style={styles.title}>
          پەیوەندی بە یاری
        </Text>

        <Text style={styles.subtitle}>
          دۆخی یاری لە سێرڤەر وەردەگیرێت...
        </Text>

      </View>

    </View>
  );
}



const styles = StyleSheet.create({

  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    elevation: 1000,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#020617",
  },


  content: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },


  title: {
    color: "#f8d774",
    fontSize: 34,
    lineHeight: 42,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },


  subtitle: {
    marginTop: 10,
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },

});