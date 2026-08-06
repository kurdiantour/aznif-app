import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";


type Props = {
  visible:boolean;
  onClose:()=>void;
};


const days = [
  {
    day:"١",
    icon:"🪙",
    reward:"500 Coin",
    status:"done",
  },
  {
    day:"٢",
    icon:"🪙",
    reward:"1000 Coin",
    status:"current",
  },
  {
    day:"٣",
    icon:"💎",
    reward:"30 گەوهەر",
    status:"lock",
  },
  {
    day:"٤",
    icon:"🪙",
    reward:"1500 Coin",
    status:"lock",
  },
  {
    day:"٥",
    icon:"💎",
    reward:"70 گەوهەر",
    status:"lock",
  },
  {
    day:"٦",
    icon:"🟡",
    reward:"1 ئەزنیف",
    status:"lock",
  },
  {
    day:"٧",
    icon:"🎁",
    reward:"صندوق ویژه",
    status:"lock",
  },
];



export default function DailyGiftModal({
 visible,
 onClose
}:Props){


return(

<Modal
visible={visible}
transparent
animationType="fade"
onRequestClose={onClose}
>


<View style={styles.overlay}>


<View style={styles.box}>


<Pressable
style={styles.close}
onPress={onClose}
>

<Ionicons
name="close-circle"
size={32}
color="#ffd45c"
/>

</Pressable>



<Text style={styles.subtitle}>
هەموو ڕۆژێک خەڵاتەکەت وەرگرە
</Text>




<ScrollView

horizontal

showsHorizontalScrollIndicator={false}

contentContainerStyle={styles.days}

>


{
days.map((item,index)=>(


<View

key={index}

style={[
styles.card,
item.status==="current" && styles.activeCard
]}

>


<Text style={styles.day}>
ڕۆژی {item.day}
</Text>



<Text style={styles.icon}>
{item.icon}
</Text>



<Text style={styles.reward}>
{item.reward}
</Text>




{
item.status==="done" &&

<View style={styles.done}>

<Ionicons
name="checkmark"
size={12}
color="#fff"
/>

<Text style={styles.doneText}>
وەرگیرا
</Text>

</View>

}





{
item.status==="lock" &&

<View style={styles.lock}>

<Ionicons
name="lock-closed"
size={15}
color="#777"
/>

</View>

}



</View>


))
}



</ScrollView>




<Text style={styles.timer}>
گیفتی داهاتوو تا 12:45:20
</Text>



</View>


</View>


</Modal>

)

}



const styles = StyleSheet.create({


overlay:{

flex:1,

backgroundColor:"rgba(0,0,0,.75)",

justifyContent:"center",

alignItems:"center",

},



box:{
width:"94%",
height:300,
backgroundColor:"#111016",
borderRadius:15,
padding:16,
borderWidth:1,
borderColor:"#c99a27",

},



close:{

position:"absolute",

right:10,

top:10,

zIndex:5,

},



subtitle:{

textAlign:"center",

color:"#aaa",

fontSize:12,

fontFamily:"Speda",

marginBottom:18,

},



days:{

alignItems:"center",

paddingHorizontal:5,

},



card:{
width:90,
height:150,
backgroundColor:"#1d1b24",
borderRadius:10,
marginHorizontal:6,
alignItems:"center",
justifyContent:"center",
borderWidth:1,
borderColor:"#34303d",
},



activeCard:{
borderColor:"#ffd45c",
transform:[
{
scale:1.10
}
],


},



day:{


color:"#fff",


fontSize:13,


fontFamily:"SpedaBold",


},



icon:{
fontSize:30,
marginVertical:10,


},



reward:{


color:"#ffd45c",


fontSize:12,


fontFamily:"SpedaBold",


textAlign:"center",


},



done:{


backgroundColor:"#218838",


paddingHorizontal:8,


paddingVertical:3,


borderRadius:12,


flexDirection:"row",


alignItems:"center",


marginTop:10,


},



doneText:{


color:"#fff",


fontSize:9,


fontFamily:"Speda",


},



lock:{


marginTop:10,


},



timer:{


textAlign:"center",


color:"#888",


fontSize:11,


marginTop:18,


fontFamily:"Speda",


},


});