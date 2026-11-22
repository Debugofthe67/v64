cmake_minimum_required(VERSION 3.28)
project(v86_install LANGUAGES CXX ASM)
include(SymbianApp)
symbian_add_executable(v86_install SOURCES bridge.cc STARTUP start.S
    LINKER_SCRIPT "${SYMBIAN_SDK_PREFIX}/cmake/freestanding_import_image.ld")
target_link_libraries(v86_install PRIVATE Symbian::EUser Symbian::FileServer "${APPARC_PROXY}" "${COMM_PROXY}")
target_include_directories(v86_install SYSTEM PRIVATE "${SYMBIAN_SDK_PREFIX}/include/native")
target_compile_options(v86_install PRIVATE -fno-exceptions -fno-rtti -fno-unwind-tables -fno-asynchronous-unwind-tables)
symbian_publish_executable(v86_install UID3 0xE0860531)
