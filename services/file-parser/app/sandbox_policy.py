import ast


MAX_SOURCE_BYTES = 100_000
ALLOWED_IMPORT_ROOTS = {
    "collections",
    "csv",
    "dateutil",
    "datetime",
    "decimal",
    "functools",
    "io",
    "itertools",
    "json",
    "math",
    "pandas",
    "pdfplumber",
    "re",
    "statistics",
    "typing",
}
FORBIDDEN_CALLS = {
    "__import__",
    "breakpoint",
    "compile",
    "delattr",
    "dir",
    "eval",
    "exec",
    "getattr",
    "globals",
    "help",
    "input",
    "locals",
    "open",
    "setattr",
    "vars",
}
FORBIDDEN_ATTRIBUTES = {
    "chmod",
    "chown",
    "connect",
    "environ",
    "execv",
    "fork",
    "kill",
    "popen",
    "remove",
    "rename",
    "rmdir",
    "send",
    "socket",
    "spawn",
    "system",
    "unlink",
}


class CandidatePolicyError(ValueError):
    pass


class _CandidateVisitor(ast.NodeVisitor):
    def visit_Import(self, node):
        for alias in node.names:
            root = alias.name.split(".", 1)[0]
            if root not in ALLOWED_IMPORT_ROOTS:
                raise CandidatePolicyError(f"Import '{root}' is not allowed")
        self.generic_visit(node)

    def visit_ImportFrom(self, node):
        root = (node.module or "").split(".", 1)[0]
        if node.level or root not in ALLOWED_IMPORT_ROOTS:
            raise CandidatePolicyError(f"Import '{node.module or ''}' is not allowed")
        self.generic_visit(node)

    def visit_Name(self, node):
        if node.id.startswith("__") or node.id in FORBIDDEN_CALLS:
            raise CandidatePolicyError(f"Name '{node.id}' is not allowed")
        self.generic_visit(node)

    def visit_Attribute(self, node):
        if node.attr.startswith("__") or node.attr in FORBIDDEN_ATTRIBUTES:
            raise CandidatePolicyError(f"Attribute '{node.attr}' is not allowed")
        self.generic_visit(node)

    def visit_Global(self, node):
        raise CandidatePolicyError("global declarations are not allowed")

    def visit_Nonlocal(self, node):
        raise CandidatePolicyError("nonlocal declarations are not allowed")


def validate_candidate_source(source_code):
    if not isinstance(source_code, str) or not source_code.strip():
        raise CandidatePolicyError("Python candidate source is required")
    if len(source_code.encode("utf-8")) > MAX_SOURCE_BYTES:
        raise CandidatePolicyError("Python candidate source exceeds 100 KB")
    try:
        tree = ast.parse(source_code, filename="candidate.py")
    except SyntaxError as error:
        raise CandidatePolicyError(f"Python candidate has invalid syntax: {error.msg}") from error
    parse_functions = [
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "parse"
    ]
    if len(parse_functions) != 1:
        raise CandidatePolicyError("Python candidate must define exactly one top-level parse(content, specification) function")
    if len(parse_functions[0].args.args) < 2:
        raise CandidatePolicyError("parse must accept content and specification arguments")
    _CandidateVisitor().visit(tree)
    return tree
