from gcodeparser import GcodeLine, get_stats


def test_get_stats_counts_and_ranges():
    lines = [
        GcodeLine(command=("G", 0), params={"X": 1, "Y": 2, "Z": 3}, comment="", line_index=0),
        GcodeLine(command=("G", 1), params={"X": 10, "Y": 20, "Z": 30, "E": 1.5}, comment="", line_index=1),
        GcodeLine(command=("G", 2), params={"X": -5, "Y": 3, "E": 0.5}, comment="", line_index=2),
        GcodeLine(command=("T", 1), params={}, comment="", line_index=3),
    ]

    stats = get_stats(lines)

    assert stats.total_lines == 4
    assert stats.counts["RAPID_MOVE"] == 1
    assert stats.counts["MOVE"] == 2
    assert stats.counts["TOOLCHANGE"] == 1

    assert stats.min_x == -5
    assert stats.max_x == 10
    assert stats.min_y == 2
    assert stats.max_y == 20
    assert stats.min_z == 3
    assert stats.max_z == 30

    assert stats.total_extrusion == 2.0
