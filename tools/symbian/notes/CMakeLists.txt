cmake_minimum_required(VERSION 3.28)
project(v86_notes LANGUAGES CXX ASM)
include(SymbianApp)
symbian_add_executable(v86_notes SOURCES app.cc STARTUP start.S
    LINKER_SCRIPT "${SYMBIAN_SDK_PREFIX}/cmake/freestanding_import_image.ld")
target_link_libraries(v86_notes PRIVATE Symbian::EUser Symbian::WindowServer Symbian::Gdi Symbian::FileServer)
target_compile_options(v86_notes PRIVATE -fno-exceptions -fno-rtti -fno-unwind-tables -fno-asynchronous-unwind-tables)
target_compile_definitions(v86_notes PRIVATE NOTES_VERSION=${NOTES_VERSION})
symbian_publish_executable(v86_notes UID3 0xE0860505)
