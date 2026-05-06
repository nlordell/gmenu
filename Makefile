.PHONY: all
all: gmenu ;

.PHONY: install
install: gmenu
	@ echo "ERROR: not yet implemented"
	@ false

gmenu: gmenu.c
	gcc -o $@ $^
