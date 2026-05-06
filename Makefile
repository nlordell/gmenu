CFLAGS += -Wall -Wextra $(shell pkg-config --cflags gio-2.0)
LDLIBS += $(shell pkg-config --libs gio-2.0)

.PHONY: all
all: gmenu ;

.PHONY: install
install: gmenu
	@ echo "ERROR: not yet implemented"
	@ false

gmenu: gmenu.c
	gcc $(CFLAGS) -o $@ $^ $(LDLIBS)

compile_commands.json: gmenu.c
	@ printf '[{"directory":"%s","file":"gmenu.c","command":"gcc %s -c gmenu.c"}]\n' \
		"$(CURDIR)" "$(CFLAGS)" > $@
