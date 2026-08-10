# Proseden

A name with 2 variations in the pronunciation:

"Prose Den" a cozy hideaway

"Prose Eden" the start of a beautiful new world

Whichever scale you have in mind, this will be prose-driven, a purely textual
environment.

This is inspired by the time I spent describing my personal space in "BayMOO"
back in the day.

## What Proseden is and isn't

Scenes and artefacts are described purely in text.

Parts of a described scene can be examined more closely for a detailed
description.

The world is populated with artefacts which can be "collected".

The scenes are navigable - a graph network (not merely cardinal compass
directions) - and an edge between scenes can represent any distance.

Navigation and interaction will be very simple, in the style of the oldest
adventure games. E.g. simple "verb noun" constructs.

Despite being an adventure around a described world, including collecting
artefacts, there is no mission.

The "reader" plays no character.

## Some technical laws of Proseden

Characters can be described in scenes and examined more closely but you
cannot converse with them. They are mere scenery.

Every reader may create an account and become a writer. All creations are
private by default but others can be invited, or a space made public. Editing
may also be extended by invitation which can include full public access.

Certain scenes can be marked as public junctions, to/from which other scenes
can be attached. The graph is directional.

Each scene has a numeric id (incremental in creation order) by which it can be
navigated to (if the user has access rights). Essentially teleporting around
Proseden.

A set of scenes may be designated with a common entry-point, so that
teleporting into the group from outside will always deliver the user to the
"entrance". Teleporting within the group is limited only by access rights.

Each edge leading from a scene also has an incremental-in-creation-order id, as
well as a nickname. Navigation can use either the number or the name.

Artefacts are placed in scenes and, like all else, are merely a text
description which can have details examined.

Each artefact is homed in a single scene. It can be moved by the owner.

Artefacts can be collected and become part of a users inventory. To help manage
the inventory these are tagged, e.g. "music", "garment", etc.

There is no limit to a users inventory - collect all the artefacts you love.

Artefacts are a _link_ to the original, not a copy.

## Moderation

There is no filter.

Some admin roles exist:

"Moderators" can edit or even delete anything that is unacceptable.

"Organisers" can change navigational links and groupings, to restructure the
world.

"Managers" administer personnel and permissions.

## Version Control

A simple content management system must be built to serve this world.

Every edit is logged but not every edited version is retained.

A scene will have a creation date and a list of modified dates. Historical
snapshots may be retained and viewed.

Navigation (graph edges) is not versioned although an edge does have a creation
date.

## Permissions

A scene has a single owner but others/all can be invited to read/edit/manage.

A scene may appear in a single group to which those rights are assigned.

The same access rights can be assigned to a "user" level, which bestows the
right to all of that user's scenes and groups. This is a way to effectively share
all of your things with invitees/everybody.

For simplicity, groups cannot be nested. The hierarchy is user -> (optional)
group -> scene.

Artefacts inherit the rights of the scene they are homed in.

Rights may be granted and removed, and also "denied". Any deny out-trumps a
grant. Using this mechanism a persona-non-grata can be blocked from aspects of a
users experience.

Deny will most likely apply at "user" level but it can be used to protect
selective groups or scenes.

## Technical implementation

I do not expect this to become especially large or popular.

I would like it to remain extremely portable and quite low-tech.

I don't see why this needs to be more complex than text files.

The navigation may need to be more carefully considered but perhaps this is also
as simple as a file of destinations from each scene.

Artefacts can also be one-per-file.

The file will contain the log of activity as well as the current and (where
relevant) historical versions, as well as "detail descriptions".

The server should actually serve all of this from memory, accessing the
filesystem only to pre-populate the in-memory cache and to save edited versions.

A very simple authentication scheme should be used.

## v1 HTTP model (implemented)

Each `GET` delivers a scene (`/s/:id`) or artefact (`/a/:id`). A querystring
key that is the detail name examines that closer description (e.g. `?card`).
Reserved keys such as `format` are not treated as detail names.

If the request asks for HTML, the description is wrapped in a page with CSS;
artefacts and destinations are hyperlinked. If it asks for text (`Accept:
text/plain`, `?format=text`, or curl-like clients), a non-markup version is
served so the world can be played with `curl`.

Public spaces need no authentication. Private scenes require an authenticated
reader with access (v1: owner only). Editing uses `PUT`/`POST` and always
requires authentication. The HTML shell includes login/register and, when
signed in, a management sidebar for CMS actions.

Artefacts are collected as inventory *links* to the original; collecting does
not remove them from their home scene.

On-disk world data lives as text/JSON files under `data/`, loaded fully into
memory at boot, with write-through on edit. See [README.md](README.md).
