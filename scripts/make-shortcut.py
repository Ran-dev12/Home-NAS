#!/usr/bin/env python3
"""
Build the ready-made iPhone shortcut "Back up to HomeNAS" as a signed .shortcut file.

Run on a Mac (signing uses the built-in `shortcuts` command and your iCloud account):

    python3 scripts/make-shortcut.py --server http://192.168.1.228:4300 --out "HomeNAS Backup.shortcut"

AirDrop the result to the iPhone. On import, Shortcuts asks for the NAS address (pre-filled with --server)
and this phone's key from HomeNAS -> Phones. The actions mirror what an iOS 26 phone saves for the manual
steps in the setup guide; the header names are written without stray spaces, which the manual build is
prone to ("Authorization " makes every request fail before it reaches HomeNAS).
"""
from __future__ import annotations  # the Python that ships with macOS is 3.9

import argparse
import plistlib
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

OBJ = "￼"  # Shortcuts marks where a variable sits inside text with this character


def new_id() -> str:
    return str(uuid.uuid4()).upper()


def output(uid: str, name: str) -> dict:
    return {"OutputName": name, "OutputUUID": uid, "Type": "ActionOutput"}


def attachment(value: dict) -> dict:
    return {"Value": value, "WFSerializationType": "WFTextTokenAttachment"}


def text(s: str, tokens: dict | None = None) -> dict:
    """Text with variables: tokens maps a character offset (of an OBJ in s) to a variable reference."""
    value: dict = {"string": s}
    if tokens:
        value["attachmentsByRange"] = {f"{{{i}, 1}}": v for i, v in tokens.items()}
    return {"Value": value, "WFSerializationType": "WFTextTokenString"}


def var(name: str, prop: str | None = None) -> dict:
    v: dict = {"Type": "Variable", "VariableName": name}
    if prop:
        v["Aggrandizements"] = [{"PropertyName": prop, "Type": "WFPropertyVariableAggrandizement"}]
    return v


def fields(items: list[dict]) -> dict:
    return {"Value": {"WFDictionaryFieldValueItems": items}, "WFSerializationType": "WFDictionaryFieldValue"}


def text_field(key: str, value: dict) -> dict:
    return {"WFItemType": 0, "WFKey": text(key), "WFValue": value}


def file_field(key: str, variable: dict) -> dict:
    return {
        "WFItemType": 5,
        "WFKey": text(key),
        "WFValue": {"Value": attachment(variable), "WFSerializationType": "WFTokenAttachmentParameterState"},
    }


def action(identifier: str, **params) -> dict:
    return {"WFWorkflowActionIdentifier": f"is.workflow.actions.{identifier}", "WFWorkflowActionParameters": params}


AUTH_HEADER = fields([text_field("Authorization", text(OBJ, {0: var("Auth")}))])


def request(uid: str, path: str, method: str = "GET", form: list[dict] | None = None) -> dict:
    params = {
        "UUID": uid,
        "WFURL": text(OBJ + path, {0: var("Server")}),
        "WFHTTPMethod": method,
        "ShowHeaders": True,
        "WFHTTPHeaders": AUTH_HEADER,
    }
    if form is not None:
        params["WFHTTPBodyType"] = "Form"
        params["WFFormValues"] = fields(form)
    return action("downloadurl", **params)


def build(server: str, limit: int) -> dict:
    t_server, t_key, sync, since, dates, photos, fmt, check, go, upload, done, message = (new_id() for _ in range(12))
    loop, gate = new_id(), new_id()
    actions = [
        action("gettext", UUID=t_server, WFTextActionText=server),
        action("setvariable", WFVariableName="Server", WFInput=attachment(output(t_server, "Text"))),
        action("gettext", UUID=t_key, WFTextActionText="Bearer PASTE-KEY-HERE"),
        action("setvariable", WFVariableName="Auth", WFInput=attachment(output(t_key, "Text"))),
        # Tells the NAS a backup starts, and where the last one stopped.
        request(sync, "/api/device/sync-state"),
        action("getvalueforkey", UUID=since, WFDictionaryKey="since", WFInput=attachment(output(sync, "Contents of URL"))),
        action("detect.date", UUID=dates, WFInput=attachment(output(since, "Dictionary Value"))),
        action(
            "filter.photos",
            UUID=photos,
            WFContentItemInputParameter="Library",
            WFContentItemFilter={
                "Value": {
                    "WFActionParameterFilterPrefix": 1,
                    "WFContentPredicateBoundedDate": False,
                    "WFActionParameterFilterTemplates": [
                        {
                            "Operator": 2,  # is after
                            "Property": "Date Taken",
                            "Removable": True,
                            "Values": {"Date": attachment(output(dates, "Dates")), "Unit": 4},
                        }
                    ],
                },
                "WFSerializationType": "WFContentPredicateTableTemplate",
            },
            WFContentItemSortProperty="Creation Date",
            WFContentItemSortOrder="Oldest First",
            WFContentItemLimitEnabled=True,
            WFContentItemLimitNumber=float(limit),
        ),
        action("repeat.each", GroupingIdentifier=loop, WFControlFlowMode=0, WFInput=attachment(output(photos, "Photos"))),
        action(
            "format.date",
            UUID=fmt,
            WFDate=text(OBJ, {0: var("Repeat Item", "Date Taken")}),
            WFDateFormatStyle="ISO 8601",
            WFISO8601IncludeTime=True,
        ),
        # Ask first, using only Date Taken (readable even for a video iOS cannot export). Shortcuts cannot catch
        # errors, so an unreadable item would stop every run; after two such runs the NAS answers "skip".
        # Upload unless told to skip, so the shortcut also works with a NAS that predates /check.
        request(check, "/api/device/check", "POST", [text_field("takenAt", text(OBJ, {0: output(fmt, "Formatted Date")}))]),
        action("getvalueforkey", UUID=go, WFDictionaryKey="skip", WFInput=attachment(output(check, "Contents of URL"))),
        action(
            "conditional",
            GroupingIdentifier=gate,
            WFControlFlowMode=0,
            WFCondition=100,  # has any value: skip, nothing to do
            WFInput={"Type": "Variable", "Variable": attachment(output(go, "Dictionary Value"))},
        ),
        action("conditional", GroupingIdentifier=gate, WFControlFlowMode=1),  # Otherwise: upload
        request(
            upload,
            "/api/device/upload",
            "POST",
            [file_field("file", var("Repeat Item")), text_field("takenAt", text(OBJ, {0: output(fmt, "Formatted Date")}))],
        ),
        action("conditional", GroupingIdentifier=gate, WFControlFlowMode=2, UUID=new_id()),
        action("repeat.each", GroupingIdentifier=loop, WFControlFlowMode=2, UUID=new_id()),
        # Commits the bookmark and returns "Backed up 12 new items …".
        request(done, "/api/device/sync-complete", "POST"),
        action("getvalueforkey", UUID=message, WFDictionaryKey="message", WFInput=attachment(output(done, "Contents of URL"))),
        action(
            "notification",
            WFNotificationActionTitle="HomeNAS",
            WFNotificationActionBody=text(OBJ, {0: output(message, "Dictionary Value")}),
            WFNotificationActionSound=False,
        ),
    ]
    return {
        "WFWorkflowActions": actions,
        "WFWorkflowClientVersion": "5037.109",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowIcon": {"WFWorkflowIconStartColor": 463140863, "WFWorkflowIconGlyphNumber": 59446},
        "WFWorkflowImportQuestions": [
            {
                "ActionIndex": 0,
                "Category": "Parameter",
                "ParameterKey": "WFTextActionText",
                "DefaultValue": server,
                "Text": "HomeNAS address, as shown in the HomeNAS window on the PC (“On your Wi-Fi”).",
            },
            {
                "ActionIndex": 2,
                "Category": "Parameter",
                "ParameterKey": "WFTextActionText",
                "DefaultValue": "Bearer PASTE-KEY-HERE",
                "Text": "This phone’s key: HomeNAS → Phones → Add phone → Copy the phone key (starts with “Bearer hn_”).",
            },
        ],
        "WFWorkflowInputContentItemClasses": [],
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowTypes": [],
        "WFWorkflowHasOutputFallback": False,
        "WFWorkflowHasShortcutInputVariables": False,
        "WFQuickActionSurfaces": [],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--server", required=True, help="NAS address, e.g. http://192.168.1.228:4300")
    ap.add_argument("--limit", type=int, default=300, help="photos and videos per run (default 300)")
    ap.add_argument("--out", default="HomeNAS Backup.shortcut")
    ap.add_argument("--unsigned", action="store_true", help="write the unsigned plist only (for inspection)")
    args = ap.parse_args()

    server = args.server.strip().rstrip("/")
    data = plistlib.dumps(build(server, args.limit), fmt=plistlib.FMT_BINARY)
    out = Path(args.out)
    if args.unsigned:
        out.write_bytes(data)
        return 0
    with tempfile.TemporaryDirectory() as tmp:
        unsigned = Path(tmp) / "unsigned.shortcut"
        unsigned.write_bytes(data)
        result = subprocess.run(["shortcuts", "sign", "--mode", "anyone", "--input", str(unsigned), "--output", str(out)], capture_output=True, text=True)
    if result.returncode != 0 or not out.exists():
        print("Signing failed:", result.stderr.strip() or result.stdout.strip(), file=sys.stderr)
        return 1
    print(f"Wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
