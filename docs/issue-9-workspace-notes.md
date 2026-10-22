# Issue #9: explicit project notes

Status: opt-in helper installed on the authorized Windows reference machine. The installed helper passed a native Leaf smoke check against a disposable generated note. See the [rollout record](helper-rollout.md). The installer copies the helper and CI includes its tests. No default binding was added.

## Use

Requires Node.js 22+ and an existing trusted Leaf installation. Installed Leaf 1.28.3 help confirms `--inline [SPEC]` with `plain` output. The helper uses `--inline=plain` to render the selected Markdown note once to stdout; it does not launch the interactive viewer or an editor.

Create a UTF-8 JSON mapping file yourself. Supply absolute paths to existing project directories and Markdown notes. For example, replace these placeholders with your own local paths:

```json
{
  "version": 1,
  "projects": [
    {
      "project": "C:\\Projects\\example",
      "notes": ["C:\\Notes\\example.md"]
    }
  ]
}
```

Then run the helper with explicit `--map`, `--project`, `--note` and `--leaf` arguments:

```powershell
node .\tools\workspace-notes.mjs --map C:\Maps\projects.json --project C:\Projects\example --note C:\Notes\example.md --leaf C:\TrustedApps\Leaf\leaf.exe
```

Quote paths containing spaces. On Linux, use absolute POSIX paths and the installed `leaf` executable. No PATH executable lookup is used. Leaf must resolve outside the selected project; the caller is responsible for choosing a trusted installation, not an executable supplied by a workspace.

Reassociate a project by editing its `notes` array in the mapping file. The next invocation rereads the mapping. There is no cache. After moving a note, update the map and select its new path. Nothing searches for the old note, creates a replacement, or copies its contents. A read-only note is supported because the helper never writes notes or changes permissions.

## Boundaries

The project path is a manual selection, not a claim about a focused Herdr pane or remote workspace. There is no Herdr API access or cwd inference. Each invocation must select a project registered in that exact map and a note registered for that project. Registration matching uses exact normalized path spelling, including case. Unicode case folding could equate distinct Windows filenames, so it is not used. Symlink aliases are not automatically treated as registered associations.

The helper reads only the chosen mapping file. It checks file/directory metadata and resolves the selected paths before handing the chosen note to Leaf. Leaf reads that note to render it. Other mapped notes are not opened or scanned. No vault discovery, private-note access, transcript capture, uploads, remote fetches, background service, or note editing is included. Review note contents as untrusted text. Rendered note text appears on stdout: avoid redirecting it to logs or sharing terminal output unintentionally.

Relative paths, URL/SSH schemes, UNC/device paths and control characters are rejected, including in unselected map entries. Local filesystem syntax is required. This is not proof that the underlying storage is a physical local disk. OS-mounted network/cloud storage cannot be detected by this helper. Choose genuinely local files. Symlinks are resolved for selected files, and resolved remote/device paths are rejected. Caller-controlled files can still change between validation and Leaf opening them. This is a local viewer, not a filesystem isolation boundary.

The map is limited to 1 MiB and must be valid UTF-8 JSON with version 1. Duplicate projects or duplicate notes within one project are errors. Missing/moved files, directories in place of notes, non-Markdown notes and Leaf launch failures stop the operation. No shell evaluates paths, and filenames are separate native arguments. There is no execution fallback or retry.

## Validation and rollback

```powershell
node --test tests/workspace-notes.test.mjs
node --check tools/workspace-notes.mjs
```

Tests use temporary synthetic projects and notes with a chosen map, including spaces and Unicode. Native Leaf calls are mocked. An actual Node CLI subprocess exercises the mapping-to-render flow with an intercepted native call. Tests cover reassociation, missing/moved notes, read-only notes, invalid mappings and remote paths, exact argument passing without a shell, and launch failures. The manager also ran the installed helper with installed Leaf against one disposable generated note. That check passed, without using user notes. Human project/note selection and remote filesystems remain unverified.

Rollback: remove `tools/workspace-notes.mjs` and any task-owned shortcut you deliberately added. Your mapping and notes remain untouched. The installer copies the helper but adds no default shortcut. Removing a copied helper does not modify its mapping or notes.
