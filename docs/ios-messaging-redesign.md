# Messaging redesign

## Principles
- Put conversations first: a prominent title, predictable search and filters, then the message list. Stories and shortcuts remain available without replacing the inbox.
- Use a restrained dark palette, layered surfaces, rounded controls and a single lavender accent. Preserve platform emoji rather than substituting an incomplete custom set.
- Keep icons paired with labels for destructive or unfamiliar actions. Maintain 44px touch targets where layout permits, visible keyboard focus, safe-area insets and 16px text inputs to avoid iOS input zoom.

## Screens
- **Home:** clear title and compose action, search, stories, compact filters, group/saved shortcuts and a consistent bottom navigation on phones. Narrow screens retain equal-width shortcut buttons.
- **Archive:** the archive filter has a recognisable icon, a short explanation, a loaded-chat count and a useful empty state. Each conversation has a visible more-options button as well as swipe and keyboard controls. Archive and delete remain separate actions; archiving does not delete messages.
- **Chat:** a translucent header and quieter controls frame the conversation. New message bubbles enter subtly from the sender's side; reactions and shortcut controls provide lightweight touch feedback. Existing chat features, audio calls and sharing remain in place.
- **Emoji:** retain the complete vertically scrolling catalog, recent choices and category navigation, with clearer selection and focus states. Native emoji rendering varies by operating system.
- **Message history:** use an archive rather than a trash icon, distinguish edits from deletions, and explain empty filter results.

## Motion and accessibility
Animations are brief and restricted to new messages and interactions; the whole history is not animated. Reduced Motion disables these effects and typing animation, and data-saver mode disables new-message animation. Reduced Transparency uses opaque navigation surfaces. Archive actions are reachable without gestures and can be closed with Escape.

## Validation and limits
Check narrow, regular and large phone viewports, desktop, keyboard navigation, reduced motion, archive/unarchive, history filters, emoji insertion and chat sending. Automated browser emulation does not replace testing on physical iPhones, especially for system fonts, safe areas, keyboards and gestures.
