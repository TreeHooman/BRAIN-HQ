# iPhone Clock alarms (iOS 26)

LUTHUR can send reminders to ntfy automatically, but those are phone notifications, not Clock alarms. For a Clock alarm requested in LUTHUR chat, HQ sends an immediate ntfy notification. Tap it to run a Shortcut on the iPhone, which creates the Clock alarm locally. HQ also saves a due reminder as a fallback. Never describe the Clock alarm as confirmed before the Shortcut runs.

On the iPhone, create a Shortcut named exactly `LUTHUR Alarm`. It should accept text input in the form `YYYY-MM-DDTHH:MM|Label`, split at `|`, turn the first part into a date/time, and use Clock’s **Create Alarm** action with that time and the second part as the label. Test it with a near-future time and check the Clock app. For a Siri-only path, the same shortcut can ask for a time when no input was supplied; Siri then runs it locally. That Siri-only path does not automatically add a LUTHUR reminder.

HQ accepts only one-time Clock alarm requests in the next 24 hours, because a standard Clock alarm is based on the next occurrence of a time, not an arbitrary future date. For later dates or repeating schedules, use a LUTHUR reminder until a date-aware phone bridge exists. If ntfy fails, HQ keeps the reminder and tells the owner no Clock alarm was created. Keep the HQ PC running for the fallback reminder.

The Shortcut must be installed and tested by the iPhone owner. Apple documents [Shortcuts URL launching](https://support.apple.com/guide/shortcuts/open-create-and-run-a-shortcut-apda283236d7/ios) and [running a shortcut from a URL](https://support.apple.com/en-au/guide/shortcuts/apd624386f42/ios); ntfy documents [tap actions](https://docs.ntfy.sh/publish/). The Clock action is listed in [Apple’s Shortcuts release notes](https://support.apple.com/en-us/101583).
