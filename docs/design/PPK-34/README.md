# PPK-34 · Animal-themed UI design concepts

This is a design spike to help the product owner pick a visual direction before any UI work starts. There are three concepts, each with static mockups of the **session lobby**, **voting** and **revealed results** screens at **desktop (1440 px)** and **mobile (390 px)** widths. That makes 18 frames in total.

Open [index.html](./index.html) in a browser. The pages are self-contained HTML/CSS with inline SVG art. They need no build step, no network access and no JavaScript.

| Concept | Mockups |
|---|---|
| A · Riverside Lounge | [concept-a.html](./concept-a.html) |
| B · Card Club | [concept-b.html](./concept-b.html) |
| C · Night Safari | [concept-c.html](./concept-c.html) |

## What every concept shares

- **Real app content only.** The screens show what the app does today: the room link, the roster (Host / ✓ Voted / Waiting / Spectating), the Spectate switch, tickets (3/10) with Story/Spike types, the story deck `1 2 3 5 8 13 20 ☕`, the host's Reveal/Reset controls, and results as frequency plus participant votes. The most common value is highlighted. The concepts add no new features, so there's no average and no `?` card.
- **The same scenario.** Priya (host, capybara) runs the session with Tom (stork), Aisha (fox) and Ben (penguin, spectating). The votes are 5, 5 and 8.
- **Animals.** Each concept redraws all eight current avatars (capybara, stork, penguin, cat, dog, fox, frog, bunny) in its own style, plus a mascot scene. The animals are decorative (`aria-hidden`) and never cover text or controls.
- **Accessibility targets.** Text meets WCAG 2.2 AA contrast. Controls and focus rings reach at least 3:1. Every control has a visible focus style and a label. Mobile touch targets are at least 44 px, and state is never shown by colour alone.

## Comparison

### A · Riverside Lounge: calm and editorial

**Direction.** Warm sand neutrals with sage and teal, serif headings and lots of whitespace. A quiet left sidebar holds the room link and people, and a wide main column holds the ticket, the vote and the results. Vote cards are soft, pebble-shaped tiles. The mascot is a capybara with a yuzu on its head in a hot spring, with a stork in the reeds.

**Strengths**
- The most restrained of the three and the easiest to read, so it suits long or frequent sessions.
- It's the closest to the current app's layout, so it would be the cheapest to build.
- The serif and neutral palette feel grown-up, and the cuteness comes only from the illustrations.

**Trade-offs**
- It's the least distinctive: with the animals removed, it could pass for a generic SaaS product.
- It feels low-energy, so a reveal is less of a moment.
- The editorial serif needs care at small sizes and with long ticket text.

### B · Card Club: tactile tabletop

**Direction.** A green felt poker table with seats around the edge and the active ticket dealt into the middle. Your vote cards fan out like a hand of playing cards, with the selected card raised. Tickets are index cards in a side rail. The mascot is a stork dealer in a visor and bow tie. Revealed cards flip face up at each seat, and the results are chip-stack bars.

**Strengths**
- It's the most playful and memorable, and the planning poker metaphor is obvious straight away.
- Who has and hasn't voted shows up spatially, at a glance around the table.
- Reveals are fun, with cards flipping at each seat.

**Trade-offs**
- It's the hardest to build. Placing seats around the table means custom layout, and the table needs rules for when more people join, up to the 50-user room limit.
- The heavy skeuomorphism could feel gimmicky to some teams.
- On mobile the table becomes a list, so the signature look gets diluted on small screens.

### C · Night Safari: sleek dark dashboard

**Direction.** A dark night-sky dashboard with near-opaque glass panels and mint and amber neon accents. On desktop there's a ticket list on the left, a stage in the middle for the ticket and vote tiles, and a roster on the right. In the roster, each person's ring shows whether they've voted, are still choosing or are spectating. On mobile, a segmented "Vote / Tickets / People" jump bar takes you to each section. The animals are glowing line art, and the mascot scene is a capybara and fox stargazing under a stork constellation.

**Strengths**
- It looks modern and premium, and a dark UI is comfortable on shared screens and in late sessions.
- It's the strongest at showing status: rings, glow and labels make voting progress obvious.
- The dashboard grid scales well to more tickets and people.

**Trade-offs**
- Dark-only would probably need a light theme too, which roughly doubles the theming work.
- Glow effects and line-art animals are subtler, so the cute side is weaker than in A or B.
- The neon accents need discipline, because too much glow quickly turns noisy.

### At a glance

| | A · Riverside Lounge | B · Card Club | C · Night Safari |
|---|---|---|---|
| Mood | Calm, editorial | Playful, tactile | Sleek, focused |
| Layout model | Sidebar + main column | Seats around a table | Three-column dashboard |
| Vote cards | Pebble tiles in one row | Fanned hand of playing cards | 4 × 2 grid of glowing tiles |
| Who has voted | Badges in a list | Seat badges plus face-down cards | Ring state plus badge |
| Results | Bars that look like water levels | Chip-stack bars, cards face up | Glowing light-beam bars |
| Animal style | Soft flat, thin outline | Sticker or enamel pin, thick outline | Glowing line art |
| Mascot | Capybara in a hot spring | Stork dealer | Capybara and fox under a stork constellation |
| Cute vs grown-up | Mostly grown-up | Most cute | Most grown-up |
| Effort to build (relative) | Low | High | Medium |
| Scales to many people | Good (list) | Weakest (seats) | Good (grid) |

Elements can be mixed. For example, B's fanned hand would work in A's layout, or C's roster rings in A. This spike didn't recommend or build a direction.

## Decision

**Product owner choice: A · Riverside Lounge.** A follow-up ticket will cover applying this direction to the real app's UI.
