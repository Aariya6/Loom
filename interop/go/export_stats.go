package main

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
)

func main() {
	s := bufio.NewScanner(os.Stdin)
	n := 0
	sum := 0.0
	for s.Scan() {
		x, e := strconv.ParseFloat(s.Text(), 64)
		if e == nil {
			n++
			sum += x
		}
	}
	if n == 0 {
		fmt.Println("0,0")
		return
	}
	fmt.Printf("%d,%.6f\n", n, sum/float64(n))
}
