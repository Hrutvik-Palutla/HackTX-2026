# SideQuest design system

The interface uses one implementation across authenticated and preview screens. Layout differences express the task, not a separate visual theme.

## Shared components

- `AppShell`: the only header, main landmark, navigation and footer implementation. Preview adds a clearly labeled sample-data notice; navigation and branding remain identical.
- `PageHeading`: the only h1 implementation. Every screen has the same context label, heading type, description spacing and optional metadata. Plan pages add a breadcrumb in the same reserved heading area.
- `PlanNavigation`: one set of active options/private/share tabs for both preview and live plans.
- `Feedback`: one keyed Motion presence component for success/error messages, using shared tokens, shorter exits, and opacity-only reduced-motion feedback.

## Tokens and surfaces

`app/globals.css` defines the single set of color, typography, spacing, radius, width and motion variables. There are no later theme overrides or page-specific font systems.

Navy text, violet controls and a neutral canvas follow SideQuest's supplied logo. White panels use a 12px radius; nested controls use 6px corners. All content forms, sections and identity lists share the panel border, shadow, spacing and 720px readable width. Dashboard columns may be narrower. A nested form uses the surrounding panel rather than drawing another box. Mobile adjusts shared layout tokens rather than restyling individual screens.

Headings use the same relative font sizes and weights on every page. Labels, helpers, selected rows, disabled fields, primary/secondary buttons and focus rings have one definition. Buttons are at least 44px tall. Dates, prices and counts use tabular numbers. Every status includes text in addition to color.

## Skill guidance

The supplied ECC `make-interfaces-feel-better` guidance informs radius/padding relationships, optical alignment, borders, text wrapping, tabular numbers, hit areas and explicit transitions. `motion-patterns` and `motion-foundations` inform the shared feedback component's presence keys, enter/exit states, shared springs/tokens and reduced-motion behavior. Persistent content does not animate for decoration.

Meta's web-app design is a reference for familiar icon-and-label tabs, white task surfaces, identity rows and clear controls. This is not an implementation of Meta's internal design system. Primary references: [Meta's web redesign account](https://engineering.fb.com/2020/05/08/web/facebook-redesign/) for readable relative type/theming, and [Design at Meta's content guidance](https://www.meta.com/design-at-meta/blog/writing-the-metaverse/) for simple, consistent language.

## Verification

The browser consistency test visits all ten preview routes on desktop and mobile. It compares heading size/weight/alignment, shell height, panel color/radius, button target sizes and horizontal overflow. A separate reduced-motion check verifies that confirmation feedback has no transform. Existing account, voting, privacy, payment and Studio browser journeys remain in the suite.

Preview includes labeled local examples for all web views. Preview sign-in never sends a code or creates a session; live sign-in is available through its explicit link. The design system does not change real account permissions, plan membership or payment authority.
