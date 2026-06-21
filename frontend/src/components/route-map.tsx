import React, { forwardRef, useImperativeHandle, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { Stop } from "@/src/types/stop";
import { buildLeafletHTML } from "./leaflet-map";

export type MapMessage =
  | { type: "map_ready" }
  | { type: "stop_clicked"; index: number };

export interface MapHandle {
  updateStops: (stops: Stop[]) => void;
  flyTo: (lat: number, lon: number, zoom?: number) => void;
}

interface Props {
  initialStops: Stop[];
  onMessage: (msg: MapMessage) => void;
}

const RouteMap = forwardRef<MapHandle, Props>(({ initialStops, onMessage }, ref) => {
  const webRef = useRef<WebView>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const html = React.useMemo(() => buildLeafletHTML(initialStops), [initialStops]);

  // Web: iframe with srcDoc + window.postMessage
  React.useEffect(() => {
    if (Platform.OS !== "web") return;
    const handler = (e: MessageEvent) => {
      if (typeof e.data !== "string") return;
      try {
        const data = JSON.parse(e.data);
        onMessage(data);
      } catch {}
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onMessage]);

  useImperativeHandle(ref, () => ({
    updateStops: (stops: Stop[]) => {
      const msg = JSON.stringify({ type: "update_stops", stops });
      if (Platform.OS === "web") {
        iframeRef.current?.contentWindow?.postMessage(msg, "*");
      } else {
        webRef.current?.postMessage(msg);
      }
    },
    flyTo: (lat: number, lon: number, zoom?: number) => {
      const msg = JSON.stringify({ type: "fly_to", lat, lon, zoom });
      if (Platform.OS === "web") {
        iframeRef.current?.contentWindow?.postMessage(msg, "*");
      } else {
        webRef.current?.postMessage(msg);
      }
    },
  }));

  if (Platform.OS === "web") {
    // @ts-ignore - React Native Web allows DOM elements
    return (
      <View style={styles.container}>
        {React.createElement("iframe", {
          ref: iframeRef,
          srcDoc: html,
          style: { width: "100%", height: "100%", border: "none", backgroundColor: "#0A0A0A" },
          sandbox: "allow-scripts allow-same-origin",
        })}
      </View>
    );
  }

  return (
    <WebView
      ref={webRef}
      originWhitelist={["*"]}
      source={{ html }}
      onMessage={(event) => {
        try {
          const data = JSON.parse(event.nativeEvent.data);
          onMessage(data);
        } catch {}
      }}
      style={styles.container}
      javaScriptEnabled
      domStorageEnabled
      androidLayerType="hardware"
    />
  );
});

RouteMap.displayName = "RouteMap";

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0A" },
});

export default RouteMap;
