# PF2e Monster Sheet Sharing

A Foundry VTT v14 module for Pathfinder 2e that lets GMs share NPC sheets with players through chat links without granting actor ownership and without exposing the NPC in the Actor Directory.

## Features

- Adds a GM-only **Share Monster Sheet** button to PF2e NPC sheets.
- Creates public clickable chat links that do not use `@UUID[Actor...]` ownership checks.
- Sends sheet data through a GM-authoritative socket request when a player clicks the link.
- Opens a temporary, local, read-only PF2e NPC sheet on the player's client.
- Leaves the original actor permissions, Actor Directory visibility, and world data unchanged.
- Exposes a macro/module API:

```js
MonsterShare.share(actor, users);
game.modules.get("pf2e-monster-sheet-sharing").api.share(actor, users);
```

## Sharing Flow

1. A GM opens a PF2e NPC sheet.
2. The GM clicks **Share Monster Sheet**.
3. A public chat message containing the monster link is posted.
4. A player clicks the link.
5. The player's client asks the GM client for the shared actor data over `module.pf2e-monster-sheet-sharing`.
6. The GM sends back sanitized actor data.
7. The player creates an unsaved local actor and opens the standard PF2e NPC sheet.

## API

```js
await MonsterShare.share(actor, users, options);
```

`actor` must be a PF2e NPC actor. `users` is an optional array of user IDs for API callers that want restricted access. If omitted, anyone who can see the chat message can request the sheet.

Options:

```js
{
  level: "full",      // "full" or "public"
  postToChat: true,   // create the chat link
  filter: (source, context) => source
}
```

The `public` level removes common mechanical data such as HP, AC, saves, attacks, spells, and GM-visible items while retaining public creature presentation data.

## Development

```bash
npm install
npm run build
npm run check
npm test
```

`npm run dev` starts the Vite reverse proxy for a running Foundry instance on `localhost:30000`; open `http://localhost:30001/game`.

## Compatibility

- Foundry VTT v14
- Pathfinder 2e system

## License

MIT. Pathfinder content remains subject to Paizo's licenses.
