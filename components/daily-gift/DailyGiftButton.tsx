import { Ionicons } from "@expo/vector-icons";
import {
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import { useState } from "react";
import DailyGiftModal from "./DailyGiftModal";


export default function DailyGiftButton() {


  const [visible, setVisible] = useState(false);



  return (

    <>

      <Pressable

        onPress={() => setVisible(true)}

        style={({pressed})=>[
          styles.button,
          pressed && styles.pressed
        ]}

      >

        <Ionicons
          name="gift"
          size={24}
          color="#ffd45c"
        />


        <View style={styles.badge}/>


      </Pressable>



      <DailyGiftModal

        visible={visible}

        onClose={() => setVisible(false)}

      />


    </>

  );

}



const styles = StyleSheet.create({

button:{
 width:44,
 height:44,
 borderRadius:22,
 alignItems:"center",
 justifyContent:"center",

 backgroundColor:
 "rgba(255,190,40,0.15)",

 borderWidth:1,

 borderColor:
 "rgba(255,210,80,0.4)",
},


badge:{
 position:"absolute",
 right:3,
 top:3,

 width:12,
 height:12,

 borderRadius:6,

 backgroundColor:"#e63946",
},


pressed:{
 opacity:.7
}

});