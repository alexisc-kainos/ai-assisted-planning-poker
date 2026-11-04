# Supplied Riverside Lounge artwork

The user supplied these generated illustrations on 2026-11-04 in
`docs/design/capybara-riverside-concepts/generated_images/`. The source files are
preserved unchanged. This records provenance, not an independent licence or
rights clearance; the original generation service and its terms were not
provided.

- `riverside.jpg` is an optimized JPEG of `riverside.jpeg` (1376 × 768), exported
  with `sips -s format jpeg -s formatOptions 80` (368,116 bytes, down from
  1,028,501 bytes). The source resolution is unchanged.
- `riverside-2.jpg`, `riverside-3.jpg` and `riverside-4.jpg` are optimized
  with the same settings from `Riverside_2.jpeg`, `riverside_3.jpeg` and
  `riverside_4.jpeg` respectively, all at the original 1376 × 768 resolution.
- `avatars/*.jpg` are separate 256 × 256 crops from the two 1408 × 768 JPEG
  contact sheets. They retain the supplied background; they are not transparent.
- Assets are imported from application source so Vite bundles them with hashed,
  base-path-aware URLs, including on GitHub Pages.
- The scene replaces the existing decorative `Mascot` illustration at the
  landing page, room-ready hero and room-side illustration positions. The
  existing sidebar, ticket layout, responsive ordering and theme are unchanged.
  All UI copy stays outside the illustration, and portrait labels come from
  the avatar catalogue.

The active ticket's position in the room's ticket list selects the scene:
tickets 1–4 use scenes 1–4, ticket 5 returns to scene 1, and so on. Selecting
an earlier ticket returns to its scene; revealing or resetting votes does not
change it. All participants use the same shared ticket order. Removing a
ticket shifts later positions and their scenes. Landing and room-ready views
continue to use scene 1.

## Crop mapping

Each source has five columns and two rows. Crop origins are `x = 43 + 267 ×
column` and `y = 73` (top row) or `452` (bottom row), with zero-based columns.
For example, the top-left portrait can be reproduced with the macOS image tool:

```sh
sips --cropToHeightWidth 256 256 --cropOffset 73 43 \
  'docs/design/capybara-riverside-concepts/generated_images/Icons 2.jpg' \
  -o frontend/src/assets/avatars/capybara.jpg
```

| Source | Row | Portraits, left to right |
|---|---|---|
| `Icons 2.jpg` | Top | Capybara, stork, penguin, fox, cat |
| `Icons 2.jpg` | Bottom | Dog, owl, mouse, sloth, tiger |
| `Icons1.jpg` | Top | Chimpanzee, elephant, lion, zebra, koala |
| `Icons1.jpg` | Bottom | Panda, giraffe, red panda, woodland fox, bat |

The two fox illustrations have separate IDs, `fox` and `woodland-fox`. The
existing `capybara`, `stork`, `penguin`, `cat`, `dog` and `fox` IDs now use the
supplied artwork. `frog` and `bunny` retain their existing drawings because no
replacement was supplied; they render for existing participants but are not
offered in the picker. The 20 supplied portraits are shown without visible
names, in five-column desktop and four-column mobile grids (no incomplete
rows). Accessible names remain on each radio option.
Unknown/absent IDs keep the existing placeholder.
The backend already accepts open-string avatar IDs, so no protocol change is
needed.
