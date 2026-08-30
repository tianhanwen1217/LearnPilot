const HOST_STYLES: Record<string, string> = {
  all: "initial",
  position: "fixed",
  top: "0",
  left: "0",
  width: "0",
  height: "0",
  margin: "0",
  padding: "0",
  border: "0",
  opacity: "1",
  visibility: "visible",
  display: "block",
  pointerEvents: "none",
  zIndex: "2147483647",
};

export function isolateExtensionHost(host: HTMLElement): void {
  for (const [property, value] of Object.entries(HOST_STYLES)) {
    const cssProperty = property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    host.style.setProperty(cssProperty, value, "important");
  }
}
