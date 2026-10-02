import { useState, useEffect } from "react";
import { Phone, X } from "lucide-react";
import AgroGuideChat from "./AgroGuideChat";

const PULSE_SEEN_KEY = "agroscope_help_pulse_seen";

export default function AgroGuideButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const [proactiveMessage, setProactiveMessage] = useState<string | undefined>();

  useEffect(() => {
    const openPanel = () => setIsOpen(true);
    window.addEventListener("openAgroGuidePanel", openPanel);
    return () => window.removeEventListener("openAgroGuidePanel", openPanel);
  }, []);

  const handleClose = () => {
    setIsOpen(false);
    setProactiveMessage(undefined);
  };

  useEffect(() => {
    if (isOpen) {
      try {
        sessionStorage.setItem(PULSE_SEEN_KEY, "1");
      } catch {
        /* ignore */
      }
    }
  }, [isOpen]);

  const showPulse = (() => {
    try {
      return !sessionStorage.getItem(PULSE_SEEN_KEY);
    } catch {
      return false;
    }
  })();

  return (
    <>
      {!isOpen ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          /* Was a gradient-filled pill on the bottom-LEFT, where it sat on top
             of the hero headline at laptop widths, and grew 5% on hover.
             Now: bottom-right (the conventional launcher corner), solid fill,
             squared to match the system, no scale bounce. */
          className="fixed bottom-5 right-5 z-[9999] flex items-center gap-2 rounded px-4 py-2.5 text-[13px] font-semibold bg-primary text-primary-foreground border border-primary shadow-md transition-colors hover:bg-primary/90 active:translate-y-px"
          aria-label="Open Message"
        >
          {showPulse && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-green-400 animate-ping" />}
          {hasUnread && (
            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
              1
            </span>
          )}
          <Phone className="h-5 w-5" />
          <span>Message</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={handleClose}
          /* --void was never defined anywhere in the stylesheet, so this
             button's background resolved to nothing. Uses real tokens now. */
          className="fixed bottom-5 right-5 z-[9999] flex h-11 w-11 items-center justify-center rounded border border-border bg-card text-foreground shadow-md transition-colors hover:bg-secondary"
          aria-label="Close Message"
        >
          <X className="h-5 w-5" />
        </button>
      )}

      {/* Always mounted — never conditionally rendered. Unmounting would tear down
          the Autopilot runner, its mic, and the screens' action registrations, so
          closing the panel used to silently kill Autopilot mid-task. The panel
          hides itself when closed and shows a floating status pill instead. */}
      <AgroGuideChat
        isOpen={isOpen}
        onClose={handleClose}
        proactiveMessage={proactiveMessage}
        onProactiveShown={() => setProactiveMessage(undefined)}
      />
    </>
  );
}
