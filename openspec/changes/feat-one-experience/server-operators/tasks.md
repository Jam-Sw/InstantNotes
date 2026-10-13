# Tasks: The server for operators

## 0. The operator's server session

- [ ] Told (SendMessage to `the operator's server continued work 1 [5a1e3b]`): the five
      points, what lands, in 0.10.1, the variable and subcommand names

## 1. Code

- [ ] `config.rs`: `INSTANTNOTES_PEOPLE_DIR` parsed into a template; tests
- [ ] `people.rs`: substitution, validation, resolution with the cache, the
      one-time move, the collision; `server.db` gains `people.username`
- [ ] `objects::Stores` resolves through `people`; `libraries` (legacy) too
- [ ] `usage` subcommand; `check` subcommand (`client.rs` reused)
- [ ] Tests of design §6
- [ ] `Dockerfile` and `release.yml`: multi-arch (with `release-chain`)
- [ ] README: people dir, usage, check, read-only root, arm64; CHANGELOG
      names every variable and subcommand
