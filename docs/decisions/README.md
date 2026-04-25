# Architectural Decision Records (ADRs)

Short markdown notes capturing the **why** behind each locked
technical choice in Skool Success OS.

## Format

Every ADR is a few hundred words max and answers four questions:

1. **Context** — what problem are we solving?
2. **Decision** — what did we pick?
3. **Consequences** — what does picking this make easier? Harder?
4. **Alternatives considered** — what else was on the table and why we
   didn’t pick it.

## Index

| #     | Decision                                                    |
| ----- | ----------------------------------------------------------- |
| 0001  | [Database: Neon Postgres](0001-database-neon-postgres.md)   |
| 0002  | [Auth: NextAuth magic link via Resend](0002-auth-magic-link-via-resend.md) |
| 0003  | [Encrypted Skool credentials (AES-256-GCM, env key)](0003-encrypted-skool-credentials.md) |
| 0004  | [CSV member import (guided, optional)](0004-csv-member-import.md) |
| 0005  | [Flashcard source pipeline (cheap-first, optional Whisper)](0005-flashcard-source-pipeline.md) |
| 0006  | [Timezone: auto-detect from browser](0006-timezone-autodetect.md) |
| 0007  | [Pulse: posts/likes ship as “coming soon”](0007-pulse-posts-coming-soon.md) |
| 0008  | [Beta cohort auto-converts to founding](0008-beta-converts-to-founding.md) |

When you make a new decision, copy `_template.md`, fill it in, bump the
number, and add a row above.
