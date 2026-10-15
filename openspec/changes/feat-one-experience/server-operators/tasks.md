# Tasks: The server for operators

## 0. The operator's server session

- [ ] Told (SendMessage to `the operator's server continued work 1 [5a1e3b]`): the five
      points, what lands, in 0.10.1, the variable and subcommand names
      (left to the integrator by decision; not done in this unit)

## 1. Code

- [x] `config.rs`: `INSTANTNOTES_PEOPLE_DIR` parsed into a template; tests
      (`people::tests::a_template_names_known_placeholders_in_an_absolute_path`)
- [x] `people.rs`: substitution, validation, resolution with the cache, the
      one-time move, the collision; `server.db` gains `persons.username`
      (with `email` and `folder`; the table is `persons`, migrated at start:
      `people::tests::an_older_server_db_gains_the_person_columns`)
- [x] `objects::Stores` resolves through `people` (`AppState::store`); a
      failed move answers `503 UNAVAILABLE`. `libraries` (legacy, read-only
      export of 0.9.5 web libraries) stays at `<data>/libraries`: it holds no
      sync store and is removed after its move into a device
- [x] `usage` subcommand; `check` subcommand (`client.rs` reused)
- [x] Tests of design §6: `people::tests::*` (substitution, each refusal, the
      move, a blocked move, the collision, the cached resolution),
      `tests/operators_test.rs` (`usage_prints_one_row_per_person_from_their_own_folder`,
      `check_proves_the_sync_path_and_leaves_nothing_behind`,
      `check_names_the_step_that_failed`,
      `a_full_sync_writes_only_under_the_data_and_people_folders` with the
      root `chmod 0555`), and the built binary run against a throwaway data
      dir (`instantnotes-server check --url http://127.0.0.1:18080`, `usage`,
      `usage --json`)
- [ ] `Dockerfile` and `release.yml`: multi-arch (with `release-chain`; not
      this unit)
- [ ] README: people dir, usage, check, read-only root, arm64; CHANGELOG
      names every variable and subcommand (lines handed to the integrator;
      documented in docs/API.md 12.6 and docs/DATA_MODEL.md 10.3)

## 2. Sign-in page look

- [x] `INSTANTNOTES_SIGN_IN_STYLESHEET`: linked after the page's own styles,
      `Content-Security-Policy` names only its origin
      (`config::tests::a_sign_in_stylesheet_is_an_https_address_or_a_same_origin_path`,
      `statics::tests::an_operator_stylesheet_comes_after_the_pages_own_and_only_its_origin_is_allowed`,
      `the_sign_in_page_links_the_operators_stylesheet_under_a_policy_naming_only_its_origin`)
- [x] The button wears `--accent` in light and dark
      (`statics::tests::the_button_wears_the_accent_in_light_and_dark`)
