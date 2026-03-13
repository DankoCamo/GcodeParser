import argparse
import os

from gcodeparser import Commands, get_stats, parse_gcode_lines

COMMAND_TYPES = {t.name: t for t in Commands}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        prog='GcodeParser',
        description='Converts a gcode file into Python GcodeLine objects, with optional filtering and serialization.',
    )

    parser.add_argument(
        'input_file',
        help='Path to the gcode file to be parsed',
    )

    parser.add_argument(
        '-o',
        '--output_file',
        help='Path to the output file. Defaults to stdout.',
        default='-',
    )

    parser.add_argument(
        '-c',
        '--include_comments',
        help='Include comment-only lines in the output.',
        action='store_true',
        default=False,
    )

    parser.add_argument(
        '-f',
        '--filter',
        help='Only output lines of this type.',
        choices=list(COMMAND_TYPES.keys()),
        default=None,
    )

    parser.add_argument(
        '--format',
        help='Output format: "repr" (default, Python repr) or "gcode" (serialized G-code)',
        choices=['repr', 'gcode'],
        default='repr',
    )

    parser.add_argument(
        '--stats',
        help='Print a summary of command counts by type instead of individual lines.',
        action='store_true',
        default=False,
    )

    args = parser.parse_args()

    with open(os.path.expanduser(args.input_file), 'r') as f:
        lines = list(parse_gcode_lines(f, include_comments=args.include_comments))

    if args.filter:
        lines = [l for l in lines if l.type == COMMAND_TYPES[args.filter]]

    if args.stats:
        print(get_stats(lines))
    else:
        def format_line(l):
            return l.gcode_str if args.format == 'gcode' else repr(l)

        if args.output_file == '-':
            for l in lines:
                print(format_line(l))
        else:
            with open(os.path.expanduser(args.output_file), 'w') as out:
                for l in lines:
                    out.write(format_line(l) + '\n')
