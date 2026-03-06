set pagination off
set confirm off
set tdesc filename RX/rxv2v3-regset
target remote localhost:61234
monitor set_internal_mem_overwrite 0-581
monitor force_rtos_off
continue
