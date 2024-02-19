package cardano

import (
	"fmt"
	"testing"
)

func TestMarshalInterface(t *testing.T) {
	return
}

func TestUnmarshalInterface(t *testing.T) {
	i := []RegisCert{
		{
			Flag:         1,
			RegisPoolId:  "RegisPoolId",
			RegisPoolVrf: "RegisPoolVrf",
		},
	}
	iBytes, _ := MarshalInterface(i)
	o := make([]RegisCert, 0)
	err := UnmarshalInterface(iBytes, &o)
	if err != nil {
		fmt.Println("aaaa")
		return
	}
	fmt.Println(o)
	return
}