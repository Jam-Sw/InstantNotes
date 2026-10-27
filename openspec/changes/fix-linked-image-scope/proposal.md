# Change: Linked image folders

## Why

`allow_image_file` widened the asset scope to any image path a note body named,
so an imported or synced note could make the app load any image on the disk
(GitHub issue #82). Images inserted in link mode (`images.storage` "link") must
keep working without a prompt.

## What Changes

- `allow_image_file` is removed. `allow_linked_images` and `pick_linked_image`
  replace it.
- Images load without asking from the vault folder and from folders in the
  device setting `images.linkedFolders`. Any other folder raises one dialog for
  all the folders a note names. Allow adds them to the setting, Keep hidden
  leaves their images unloaded for the rest of the app run.
- Settings > Images lists and removes the allowed folders.
- The asset scope in `tauri.conf.json` stays `$APPDATA/attachments/**`.

## MODIFIED Requirements

### Requirement: Linked images load only from allowed folders

Linked images SHALL load only from the attachments directory, the vault folder
and folders the person has allowed. A note that links to an image elsewhere
SHALL NOT make that image load until the person allows its folder.

#### Scenario: A note linking into the vault folder loads without asking

- **GIVEN** a note whose body links to an image under the vault root
- **WHEN** the note is opened
- **THEN** the image loads
- **AND** no dialog is shown

#### Scenario: A note linking into an unknown folder asks once

- **GIVEN** a note whose body links to an image in a folder that is neither the
  vault folder nor allowed
- **WHEN** the note is opened
- **THEN** one dialog titled "Show images from outside your library?" is shown
  naming that folder
- **AND** the image loads only when the person chooses "Allow"

#### Scenario: Keep hidden leaves the image unloaded

- **GIVEN** the dialog for an unknown folder is shown
- **WHEN** the person chooses "Keep hidden"
- **THEN** the image does not load
- **AND** the folder is not added to `images.linkedFolders`
- **AND** the app does not ask again for that folder during this run

#### Scenario: A file picked in link mode needs no prompt

- **GIVEN** the person inserts an image in link mode
- **WHEN** they choose the file in the native picker
- **THEN** the file loads at once
- **AND** no folder dialog is shown

## ADDED Requirements

### Requirement: Settings > Images lists the allowed folders

Settings > Images SHALL list every folder in `images.linkedFolders`, each with a
Remove button, under the group "Linked folders" with the sentence "Images in
notes load from these folders. A note that links elsewhere asks first." The
group SHALL be hidden on the web.

#### Scenario: Removing a folder

- **GIVEN** `images.linkedFolders` contains a folder
- **WHEN** the person presses Remove beside it
- **THEN** the folder is removed from `images.linkedFolders`
- **AND** the list updates without a restart
