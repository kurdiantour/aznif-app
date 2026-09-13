import { Redirect } from "expo-router";
import { useState } from "react";

function createPracticeMatchId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export default function PlayAIModeScreen() {
  const [practiceMatchId] = useState(createPracticeMatchId);

  return (
    <Redirect
      href={{
        pathname: "/domino/game",
        params: {
          room_id: practiceMatchId,
          mode: "1v1",
          practice: "true",
          playMode: "fun",
        },
      }}
    />
  );
}
