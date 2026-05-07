CFLAGS += -Wall -Wextra $(shell pkg-config --cflags gio-2.0)
LDLIBS += $(shell pkg-config --libs gio-2.0)

.PHONY: all
all: gmenu extension ;

.PHONY: install
install: gmenu
	@ echo "ERROR: not yet implemented"
	@ false

gmenu: gmenu.c
	gcc $(CFLAGS) -o $@ $^ $(LDLIBS)

.PHONY: extension
extension:
	npx tsc

.PHONY: fmt
fmt:
	clang-format -i gmenu.c
	npx prettier -w extension.js

compile_commands.json: Makefile
	printf '[{"directory":"%s","file":"gmenu.c","command":"gcc %s -c gmenu.c"}]\n' \
		"$(CURDIR)" "$(CFLAGS)" > $@
