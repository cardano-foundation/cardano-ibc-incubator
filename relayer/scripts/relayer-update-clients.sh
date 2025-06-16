#!/bin/sh

path=demo


alias rly=./bin/rly

max=100
for i in `seq 2 $max`
do
  sleep 5
  rly transact update-clients $path
done



