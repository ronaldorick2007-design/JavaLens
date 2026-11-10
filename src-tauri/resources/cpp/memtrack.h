#pragma once
#include <cstdlib>
#include <new>

// kind: 1=new 2=new[] 3=delete 4=delete[]
extern "C" __attribute__((noinline, used))
void memtrack_event(int kind, void *addr, unsigned long size) {
    asm volatile("" ::: "memory");
}

extern "C" __attribute__((noinline)) void point(void* address, const char* color) {
    asm volatile("" : : "r"(address), "r"(color) : "memory");
}

static void *mt_alloc(std::size_t n, int kind) {
    void *p = std::malloc(n ? n : 1);
    if (!p) throw std::bad_alloc();
    memtrack_event(kind, p, n);
    return p;
}
static void mt_free(void *p, int kind) {
    if (!p) return;
    memtrack_event(kind, p, 0);   // pointer is still valid here
    std::free(p);
}

void *operator new(std::size_t n)   { return mt_alloc(n, 1); }
void *operator new[](std::size_t n) { return mt_alloc(n, 2); }
void operator delete(void *p) noexcept   { mt_free(p, 3); }
void operator delete[](void *p) noexcept { mt_free(p, 4); }
void operator delete(void *p, std::size_t) noexcept   { mt_free(p, 3); }
void operator delete[](void *p, std::size_t) noexcept { mt_free(p, 4); }
